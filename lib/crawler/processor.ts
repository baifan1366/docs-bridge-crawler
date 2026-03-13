/**
 * Main page processor
 * Handles crawling, extraction, chunking, and embedding generation
 */

import { createClient } from '../supabase/server';
import { smartFetch } from './smart-fetcher';
import { chunkBySections, fallbackChunking } from '../processing/section-chunker';
import { extractWithRules } from '../processing/rule-extractor';
import { generateEmbedding } from '../embeddings/generator';
import { logCrawlMetrics } from '../monitoring/metrics';
import { createHash } from 'crypto';
import * as cheerio from 'cheerio';

export async function processPage(url: string, sourceId: string) {
  console.log(`[START] Processing: ${url}`);
  const startTime = Date.now();
  
  const supabase = await createClient();

  try {
    // 1. Get source config
    const { data: source } = await supabase
      .from('crawler_sources')
      .select('*')
      .eq('id', sourceId)
      .single();

    if (!source) {
      throw new Error(`Source not found: ${sourceId}`);
    }

    // 2. Get existing page data
    const { data: existingPage } = await supabase
      .from('crawler_pages')
      .select('*')
      .eq('url', url)
      .single();

    // 3. Smart Fetch (If-Modified-Since + ETag)
    const fetchResult = await smartFetch(url, existingPage);

    if (fetchResult.status === 'not-modified') {
      console.log(`[SKIP] Not modified: ${url}`);
      await updatePageStatus(supabase, url, 'skipped');
      return { status: 'skipped', reason: 'not-modified' };
    }

    if (fetchResult.status === 'error' || !fetchResult.html) {
      console.error(`[ERROR] Fetch failed: ${url}`);
      await updatePageStatus(supabase, url, 'failed');
      return { status: 'failed', reason: 'fetch-error' };
    }

    // 4. Content Hash check
    const html = fetchResult.html;
    const contentHash = createHash('sha256').update(html).digest('hex');

    if (existingPage && existingPage.content_hash === contentHash) {
      console.log(`[SKIP] Content unchanged: ${url}`);
      await updatePageStatus(supabase, url, 'skipped');
      return { status: 'skipped', reason: 'content-unchanged' };
    }

    console.log(`[PROCESS] Content changed: ${url}`);

    // 5. HTML Cleaning
    const $ = cheerio.load(html);
    $('script, style, nav, footer, header, .ads').remove();
    const text = $('body').text().replace(/\s+/g, ' ').trim();
    const title = $('title').text() || $('h1').first().text();
    const language = $('html').attr('lang') || 'en';

    // 6. Update page record
    const { data: page } = await supabase
      .from('crawler_pages')
      .upsert({
        source_id: sourceId,
        url,
        url_hash: createHash('sha256').update(url).digest('hex'),
        content_hash: contentHash,
        title,
        language,
        last_crawled_at: new Date().toISOString(),
        crawl_status: 'success',
        etag: fetchResult.etag,
        last_modified_header: fetchResult.lastModified,
        metadata: {
          word_count: text.split(/\s+/).length
        }
      }, { onConflict: 'url' })
      .select()
      .single();

    // 7. Create/update document
    const { data: document } = await supabase
      .from('kb_documents')
      .upsert({
        folder_id: await getOrCreateFolder(supabase, source.name),
        title,
        content: text,
        raw_content: html,
        content_hash: contentHash,
        document_type: 'gov_crawled',
        source_url: url,
        language,
        trust_level: source.metadata?.trust_level || 1.0,
        last_crawled_at: new Date().toISOString(),
        metadata: {
          ...source.metadata,
          page_type: detectPageType(title, text)
        }
      }, { onConflict: 'source_url' })
      .select()
      .single();

    // 8. Rule-Based Extraction
    const extracted = extractWithRules(html, text);

    await supabase
      .from('document_structured_data')
      .upsert({
        document_id: document.id,
        page_id: page.id,
        ...extracted
      }, { onConflict: 'document_id' });

    // 9. Section-Aware Chunking
    let chunks = chunkBySections(html);
    
    if (chunks.length === 0) {
      console.log('[FALLBACK] No sections found, using token-based chunking');
      chunks = fallbackChunking(text);
    }

    console.log(`[CHUNKS] Created ${chunks.length} chunks`);

    // 10. Delete old chunks
    await supabase
      .from('document_chunks')
      .delete()
      .eq('document_id', document.id);

    // 11. Generate embeddings and store
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      
      const embedding = await generateEmbedding(chunk.text);

      await supabase
        .from('document_chunks')
        .insert({
          document_id: document.id,
          page_id: page.id,
          chunk_text: chunk.text,
          chunk_index: i,
          chunk_hash: createHash('sha256').update(chunk.text).digest('hex'),
          embedding_large: embedding,
          token_count: chunk.tokenCount,
          section_heading: chunk.heading,
          section_level: chunk.level,
          is_section_chunk: true,
          metadata: {
            section_type: chunk.sectionType,
            position: i === 0 ? 'start' : i === chunks.length - 1 ? 'end' : 'middle'
          }
        });
    }

    console.log(`[SUCCESS] Completed: ${url} (${chunks.length} chunks)`);

    const duration = Date.now() - startTime;

    // Log metrics
    await logCrawlMetrics({
      url,
      status: 'success',
      duration_ms: duration,
      chunks_created: chunks.length,
      extraction_method: extracted.extraction_method,
      extraction_confidence: extracted.confidence
    });

    return {
      status: 'success',
      url,
      chunks: chunks.length,
      extraction_method: extracted.extraction_method,
      extraction_confidence: extracted.confidence,
      duration_ms: duration
    };

  } catch (error: any) {
    console.error(`[ERROR] Processing failed for ${url}:`, error);
    await updatePageStatus(supabase, url, 'failed', error.message);
    
    const duration = Date.now() - startTime;
    
    // Log failure metrics
    await logCrawlMetrics({
      url,
      status: 'failed',
      duration_ms: duration,
      chunks_created: 0,
      extraction_method: 'rules',
      extraction_confidence: 0
    });
    
    throw error;
  }
}

async function updatePageStatus(
  supabase: any,
  url: string,
  status: 'success' | 'failed' | 'skipped',
  errorMessage?: string
) {
  await supabase
    .from('crawler_pages')
    .update({
      last_crawled_at: new Date().toISOString(),
      crawl_status: status,
      error_message: errorMessage
    })
    .eq('url', url);
}

async function getOrCreateFolder(supabase: any, sourceName: string): Promise<string> {
  const { data: existing } = await supabase
    .from('kb_folders')
    .select('id')
    .eq('name', sourceName)
    .eq('folder_type', 'official_gov')
    .single();

  if (existing) return existing.id;

  const { data: newFolder } = await supabase
    .from('kb_folders')
    .insert({
      name: sourceName,
      folder_type: 'official_gov',
      is_system: true,
      is_active: true
    })
    .select()
    .single();

  return newFolder!.id;
}

function detectPageType(title: string, text: string): string {
  const lower = (title + ' ' + text).toLowerCase();
  
  if (lower.includes('program') || lower.includes('bantuan')) return 'program';
  if (lower.includes('policy') || lower.includes('dasar')) return 'policy';
  if (lower.includes('form') || lower.includes('borang')) return 'form';
  if (lower.includes('guide') || lower.includes('panduan')) return 'guide';
  
  return 'general';
}
