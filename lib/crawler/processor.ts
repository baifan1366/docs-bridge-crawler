/**
 * Main page processor
 * Handles crawling, extraction, chunking, and embedding generation
 */

import { createClient } from '../supabase/server';
import { smartFetch } from './smart-fetcher';
import { chunkBySections, fallbackChunking } from '../processing/section-chunker';
import { extractWithRules } from '../processing/rule-extractor';
import { generateDualEmbeddings } from '../embeddings/generator';
import { logCrawlMetrics } from '../monitoring/metrics';
import { createHash } from 'crypto';
import * as cheerio from 'cheerio';

export async function processPage(url: string, sourceId: string) {
  console.log(`[START] Processing: ${url}`);
  console.log(`[INFO] Source ID: ${sourceId}`);
  const startTime = Date.now();
  
  const supabase = await createClient();

  try {
    // 1. Get source config
    console.log(`[STEP 1] Fetching source config...`);
    const { data: source, error: sourceError } = await supabase
      .from('crawler_sources')
      .select('*')
      .eq('id', sourceId)
      .single();

    if (sourceError) {
      console.error(`[ERROR] Failed to fetch source:`, sourceError);
      throw new Error(`Source fetch error: ${sourceError.message}`);
    }

    if (!source) {
      throw new Error(`Source not found: ${sourceId}`);
    }

    console.log(`[STEP 1] Source found: ${source.name}`);

    // 2. Get existing page data
    console.log(`[STEP 2] Checking for existing page...`);
    const { data: existingPage } = await supabase
      .from('crawler_pages')
      .select('*')
      .eq('url', url)
      .single();

    if (existingPage) {
      console.log(`[STEP 2] Found existing page, last crawled: ${existingPage.last_crawled_at}`);
    } else {
      console.log(`[STEP 2] No existing page found`);
    }

    // 3. Smart Fetch (If-Modified-Since + ETag)
    console.log(`[STEP 3] Starting smart fetch...`);
    const fetchResult = await smartFetch(url, existingPage);

    if (fetchResult.status === 'not-modified') {
      console.log(`[SKIP] Not modified: ${url}`);
      await updatePageStatus(supabase, url, 'skipped');
      return { status: 'skipped', reason: 'not-modified' };
    }

    if (fetchResult.status === 'error' || !fetchResult.html) {
      const errorMsg = fetchResult.errorMessage || 'Unknown fetch error';
      console.error(`[ERROR] Fetch failed: ${url} - ${errorMsg}`);
      
      // Record the failed page
      console.log(`[STEP 3.1] Recording failed page...`);
      const { error: pageInsertError } = await supabase
        .from('crawler_pages')
        .upsert({
          source_id: sourceId,
          url,
          url_hash: createHash('sha256').update(url).digest('hex'),
          last_crawled_at: new Date().toISOString(),
          crawl_status: 'failed',
          error_message: errorMsg
        }, { onConflict: 'url' });
      
      if (pageInsertError) {
        console.error(`[ERROR] Failed to record failed page:`, pageInsertError);
      } else {
        console.log(`[STEP 3.1] Failed page recorded`);
      }
      
      return { status: 'failed', reason: 'fetch-error', error: errorMsg };
    }

    // 4. Content Hash check
    console.log(`[STEP 4] Checking content hash...`);
    const html = fetchResult.html;
    const contentHash = createHash('sha256').update(html).digest('hex');

    if (existingPage && existingPage.content_hash === contentHash) {
      console.log(`[SKIP] Content unchanged: ${url}`);
      await updatePageStatus(supabase, url, 'skipped');
      return { status: 'skipped', reason: 'content-unchanged' };
    }

    console.log(`[PROCESS] Content changed or new page: ${url}`);

    // 5. HTML Cleaning
    console.log(`[STEP 5] Cleaning HTML...`);
    const $ = cheerio.load(html);
    $('script, style, nav, footer, header, .ads').remove();
    const text = $('body').text().replace(/\s+/g, ' ').trim();
    const title = $('title').text() || $('h1').first().text();
    const language = $('html').attr('lang') || 'en';
    console.log(`[STEP 5] Extracted - Title: "${title}", Language: ${language}, Text length: ${text.length}`);

    // 6. Update page record
    console.log(`[STEP 6] Creating/updating page record...`);
    const { data: page, error: pageError } = await supabase
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

    if (pageError || !page) {
      console.error(`[ERROR] Failed to upsert page:`, pageError);
      throw new Error(`Failed to create/update page record: ${pageError?.message || 'No data returned'}`);
    }

    console.log(`[PAGE] Created/updated page record: ${page.id}`);

    // 7. Create/update document
    console.log(`[STEP 7] Getting or creating folder...`);
    const folderId = await getOrCreateFolder(supabase, source.name);
    console.log(`[DOCUMENT] Using folder: ${folderId}`);
    
    console.log(`[STEP 7] Creating/updating document...`);
    console.log(`[DEBUG] Document data:`, {
      folder_id: folderId,
      title,
      source_url: url,
      content_length: text.length,
      content_hash: contentHash,
      document_type: 'gov_crawled',
      language
    });
    
    // Check if document exists with same source_url and content_hash
    // We use content_hash to identify if it's the same content
    const { data: existingDocs } = await supabase
      .from('kb_documents')
      .select('id, content_hash')
      .eq('source_url', url)
      .eq('document_type', 'gov_crawled');
    
    console.log(`[DEBUG] Found ${existingDocs?.length || 0} existing documents for this URL`);
    
    // Find document with matching content_hash (same content)
    const existingDoc = existingDocs?.find(doc => doc.content_hash === contentHash);
    
    let document;
    let docError;
    
    if (existingDoc) {
      // Update existing document with same content
      console.log(`[DEBUG] Updating existing document: ${existingDoc.id}`);
      const result = await supabase
        .from('kb_documents')
        .update({
          folder_id: folderId,
          title,
          content: text,
          raw_content: html,
          content_hash: contentHash,
          language,
          trust_level: source.metadata?.trust_level || 1.0,
          last_crawled_at: new Date().toISOString(),
          metadata: {
            ...source.metadata,
            page_type: detectPageType(title, text)
          }
        })
        .eq('id', existingDoc.id)
        .select()
        .single();
      
      document = result.data;
      docError = result.error;
    } else {
      // Insert new document (either first time or content changed significantly)
      console.log(`[DEBUG] Inserting new document`);
      const result = await supabase
        .from('kb_documents')
        .insert({
          folder_id: folderId,
          user_id: null,
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
        })
        .select()
        .single();
      
      document = result.data;
      docError = result.error;
      
      // If we inserted a new document but there were old ones, optionally clean up old versions
      if (!docError && existingDocs && existingDocs.length > 0) {
        console.log(`[DEBUG] Cleaning up ${existingDocs.length} old document versions`);
        const oldDocIds = existingDocs.map(d => d.id);
        await supabase
          .from('kb_documents')
          .delete()
          .in('id', oldDocIds);
      }
    }

    if (docError || !document) {
      console.error(`[ERROR] Failed to save document:`, docError);
      console.error(`[ERROR] Error details:`, JSON.stringify(docError, null, 2));
      throw new Error(`Failed to create/update document: ${docError?.message || 'No data returned'}`);
    }

    console.log(`[DOCUMENT] Created/updated document: ${document.id}`);

    // 8. Rule-Based Extraction
    console.log(`[STEP 8] Extracting structured data...`);
    const extracted = extractWithRules(html, text);
    console.log(`[STEP 8] Extraction complete - Method: ${extracted.extraction_method}, Confidence: ${extracted.confidence}`);

    const { error: structuredError } = await supabase
      .from('document_structured_data')
      .upsert({
        document_id: document.id,
        page_id: page.id,
        ...extracted
      }, { onConflict: 'document_id' });

    if (structuredError) {
      console.error(`[WARNING] Failed to save structured data:`, structuredError);
    } else {
      console.log(`[STEP 8] Structured data saved`);
    }

    // 9. Section-Aware Chunking
    console.log(`[STEP 9] Chunking content...`);
    let chunks = chunkBySections(html);
    
    if (chunks.length === 0) {
      console.log('[FALLBACK] No sections found, using token-based chunking');
      chunks = fallbackChunking(text);
    }

    console.log(`[CHUNKS] Created ${chunks.length} chunks`);

    // 10. Delete old chunks
    console.log(`[STEP 10] Deleting old chunks...`);
    const { error: deleteError } = await supabase
      .from('document_chunks')
      .delete()
      .eq('document_id', document.id);

    if (deleteError) {
      console.error(`[WARNING] Failed to delete old chunks:`, deleteError);
    } else {
      console.log(`[STEP 10] Old chunks deleted`);
    }

    // 11. Generate embeddings and store
    console.log(`[STEP 11] Generating embeddings and storing chunks...`);
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      
      if (i % 10 === 0) {
        console.log(`[STEP 11] Processing chunk ${i + 1}/${chunks.length}...`);
      }
      
      const embeddings = await generateDualEmbeddings(chunk.text);

      const { error: chunkError } = await supabase
        .from('document_chunks')
        .insert({
          document_id: document.id,
          page_id: page.id,
          chunk_text: chunk.text,
          chunk_index: i,
          chunk_hash: createHash('sha256').update(chunk.text).digest('hex'),
          embedding_small: embeddings.small,  // 384-dim from e5-small
          embedding_large: embeddings.large,  // 1024-dim from bge-m3
          token_count: chunk.tokenCount,
          section_heading: chunk.heading,
          section_level: chunk.level,
          is_section_chunk: true,
          metadata: {
            section_type: chunk.sectionType,
            position: i === 0 ? 'start' : i === chunks.length - 1 ? 'end' : 'middle'
          }
        });

      if (chunkError) {
        console.error(`[ERROR] Failed to insert chunk ${i}:`, chunkError);
        throw chunkError;
      }
    }

    console.log(`[SUCCESS] Completed: ${url} (${chunks.length} chunks)`);

    const duration = Date.now() - startTime;

    // Log metrics
    console.log(`[STEP 12] Logging metrics...`);
    await logCrawlMetrics({
      url,
      status: 'success',
      duration_ms: duration,
      chunks_created: chunks.length,
      extraction_method: extracted.extraction_method,
      extraction_confidence: extracted.confidence
    });

    console.log(`[COMPLETE] Total processing time: ${duration}ms`);

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
    console.error(`[ERROR] Error stack:`, error.stack);
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
  // First try to get existing folder
  const { data: existing, error: selectError } = await supabase
    .from('kb_folders')
    .select('id')
    .eq('name', sourceName)
    .eq('folder_type', 'official_gov')
    .single();

  if (existing) {
    console.log(`[FOLDER] Using existing folder: ${sourceName} (${existing.id})`);
    return existing.id;
  }

  // If not found, try to create
  console.log(`[FOLDER] Creating new folder: ${sourceName}`);
  const { data: newFolder, error: insertError } = await supabase
    .from('kb_folders')
    .insert({
      name: sourceName,
      folder_type: 'official_gov',
      is_system: true,
      is_active: true,
      user_id: null  // System folders have no user
    })
    .select()
    .single();

  if (insertError) {
    console.error(`[FOLDER] Insert error:`, insertError);
    
    // Might be a race condition, try to get again
    const { data: retryExisting } = await supabase
      .from('kb_folders')
      .select('id')
      .eq('name', sourceName)
      .eq('folder_type', 'official_gov')
      .single();
    
    if (retryExisting) {
      console.log(`[FOLDER] Found folder after retry: ${sourceName} (${retryExisting.id})`);
      return retryExisting.id;
    }
    
    throw new Error(`Failed to get or create folder: ${insertError.message}`);
  }

  if (!newFolder) {
    throw new Error(`Failed to create folder: no data returned`);
  }

  console.log(`[FOLDER] Created new folder: ${sourceName} (${newFolder.id})`);
  return newFolder.id;
}

function detectPageType(title: string, text: string): string {
  const lower = (title + ' ' + text).toLowerCase();
  
  if (lower.includes('program') || lower.includes('bantuan')) return 'program';
  if (lower.includes('policy') || lower.includes('dasar')) return 'policy';
  if (lower.includes('form') || lower.includes('borang')) return 'form';
  if (lower.includes('guide') || lower.includes('panduan')) return 'guide';
  
  return 'general';
}
