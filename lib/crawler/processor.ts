/**
 * Main page processor - FIXED VERSION
 * Handles crawling, extraction, chunking, and embedding generation
 */

import { createClient } from '../supabase/server';
import { smartFetch } from './smart-fetcher';
import { chunkBySections, fallbackChunking } from '../processing/section-chunker';
import { extractWithRules } from '../processing/rule-extractor';
import { generateDualEmbeddings } from '../embeddings/generator';
import { CRAWLER_CONFIG, getTruncatedContent, getTruncatedHtml, isContentValid, getProcessingMetadata } from './config';
import { safeDocumentUpsert } from './db-utils';
import { createDocumentChunker } from '../processing/document-chunker';
import { getEmbeddingQueue } from '../queue/embedding-queue';
import { isPDFUrl, processPDF, cleanPDFText } from './pdf-processor';
import { logCrawlMetrics } from '../monitoring/metrics';
import { createHash } from 'crypto';
import * as cheerio from 'cheerio';

// Import new standard processing modules
import { cleanHTML } from '../processing/html-cleaner';
import { parseDocumentStructure } from '../processing/structure-parser';
import { normalizeText } from '../processing/text-normalizer';
import { SemanticChunker } from '../processing/semantic-chunker';
import { generateMetadata } from '../processing/metadata-generator';


export async function processPage(url: string, sourceId: string) {
  console.log(`[START] Processing: ${url}`);
  console.log(`[INFO] Source ID: ${sourceId}`);
  const startTime = Date.now();
  
  const supabase = await createClient();

  // Declare all variables at function scope
  let html: string;
  let text: string;
  let title: string;
  let language: string;
  let contentHash: string;
  let imageAlts: string[] = [];
  let tables: any[] = [];
  let page: any;
  let cleaningResult: any;
  let documentStructure: any;
  let normalizationResult: any;
  let semanticChunkingResult: any;

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

    console.log(`[STEP 3] Starting smart fetch...`);
    
    // Check if URL is PDF
    if (isPDFUrl(url)) {
      console.log(`[PDF] Detected PDF URL: ${url}`);
      try {
        const pdfResult = await processPDF(url);
        const cleanedText = cleanPDFText(pdfResult.text);
        
        // Create page record for PDF
        const { data: pdfPage, error: pageError } = await supabase
          .from('crawler_pages')
          .upsert({
            source_id: sourceId,
            url,
            url_hash: createHash('sha256').update(url).digest('hex'),
            content_hash: createHash('sha256').update(cleanedText).digest('hex'),
            title: pdfResult.metadata.title || 'PDF Document',
            language: 'en',
            last_crawled_at: new Date().toISOString(),
            crawl_status: 'success',
            metadata: {
              document_type: 'pdf',
              ...pdfResult.metadata
            }
          }, { onConflict: 'url' })
          .select()
          .single();

        if (pageError || !pdfPage) {
          throw new Error(`Failed to create PDF page record: ${pageError?.message}`);
        }

        // Set variables for document processing
        html = `<html><body><h1>${pdfResult.metadata.title || 'PDF Document'}</h1><div>${cleanedText.replace(/\n/g, '</p><p>')}</div></body></html>`;
        text = cleanedText;
        title = pdfResult.metadata.title || 'PDF Document';
        language = 'en';
        contentHash = createHash('sha256').update(text).digest('hex');
        page = pdfPage;
        
        console.log(`[PDF] Processed - Title: "${title}", Text length: ${text.length}, Pages: ${pdfResult.metadata.pages}`);
        
      } catch (error) {
        console.error(`[PDF] Failed to process PDF:`, error);
        await updatePageStatus(supabase, url, 'failed', `PDF processing error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        return { status: 'failed', reason: 'pdf-processing-error', error: error instanceof Error ? error.message : 'Unknown error' };
      }
    } else {
      // Regular HTML processing
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
      html = fetchResult.html;
      contentHash = createHash('sha256').update(html).digest('hex');

      if (existingPage && existingPage.content_hash === contentHash) {
        console.log(`[SKIP] Content unchanged: ${url}`);
        await updatePageStatus(supabase, url, 'skipped');
        return { status: 'skipped', reason: 'content-unchanged' };
      }

      console.log(`[PROCESS] Content changed or new page: ${url}`);

      // 5. Standard Data Processing Pipeline (Hackathon Quality)
      console.log(`[STEP 5] Starting standard data processing pipeline...`);
      
      // 5.1 HTML Cleaning (Government-specific)
      console.log(`[STEP 5.1] HTML cleaning with government-specific patterns...`);
      cleaningResult = await cleanHTML(html, {
        removeNavigation: true,
        removeFooter: true,
        removeSidebar: true,
        removeAds: true,
        removeCookieBanners: true,
        preserveStructure: true,
        minContentLength: 100
      });
      
      text = cleaningResult.cleanText;
      title = cleaningResult.title;
      language = cleaningResult.language;
      
      console.log(`[STEP 5.1] HTML cleaned - Method: ${cleaningResult.metadata.extractionMethod}, Score: ${cleaningResult.metadata.contentScore}`);
      console.log(`[STEP 5.1] Content reduced from ${cleaningResult.metadata.originalLength} to ${cleaningResult.metadata.cleanedLength} chars`);
      
      // 5.2 Document Structure Parsing
      console.log(`[STEP 5.2] Parsing document structure...`);
      documentStructure = parseDocumentStructure(html, text);
      
      console.log(`[STEP 5.2] Structure parsed - ${documentStructure.metadata.totalSections} sections, max depth: ${documentStructure.metadata.maxDepth}`);
      console.log(`[STEP 5.2] Structure type: ${documentStructure.metadata.structureType}, method: ${documentStructure.metadata.extractionMethod}`);
      
      // 5.3 Text Normalization
      console.log(`[STEP 5.3] Normalizing text...`);
      normalizationResult = await normalizeText(text, {
        removeDuplicateLines: true,
        normalizeWhitespace: true,
        fixEncoding: true,
        removePageNumbers: true,
        removeHeaders: true,
        removeFooters: true,
        minLineLength: 3
      });
      
      text = normalizationResult.normalizedText;
      
      console.log(`[STEP 5.3] Text normalized - ${normalizationResult.metadata.duplicatesRemoved} duplicates removed`);
      console.log(`[STEP 5.3] Fixed ${normalizationResult.metadata.encodingIssuesFixed} encoding issues, removed ${normalizationResult.metadata.pageNumbersRemoved} page numbers`);
      
      // Extract legacy metadata for compatibility
      const $ = cheerio.load(html);
      $('img[alt]').each((i, elem) => {
        const alt = $(elem).attr('alt')?.trim();
        if (alt && alt.length > 3) {
          imageAlts.push(alt);
        }
      });
      tables = extractTables($);
      
      console.log(`[STEP 5] Standard processing complete - Title: "${title}", Language: ${language}, Text length: ${text.length}`);
      console.log(`[STEP 5] Found ${imageAlts.length} images with alt text, ${tables.length} tables`);

      // 6. Update page record
      console.log(`[STEP 6] Creating/updating page record...`);
      const { data: htmlPage, error: pageError } = await supabase
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
            word_count: text.split(/\s+/).length,
            images_with_alt: imageAlts.length,
            tables_count: tables.length
          }
        }, { onConflict: 'url' })
        .select()
        .single();

      if (pageError || !htmlPage) {
        console.error(`[ERROR] Failed to upsert page:`, pageError);
        throw new Error(`Failed to create/update page record: ${pageError?.message || 'No data returned'}`);
      }

      page = htmlPage;
      console.log(`[PAGE] Created/updated page record: ${page.id}`);
    }

    // 7. Create/update document
    console.log(`[STEP 7] Getting or creating folder...`);
    const folderId = await getOrCreateFolder(supabase, source.name);
    console.log(`[DOCUMENT] Using folder: ${folderId}`);
    
    console.log(`[STEP 7] Creating/updating document...`);
    
    // Limit content size to prevent database timeouts
    const truncatedText = getTruncatedContent(text);
    const truncatedHtml = getTruncatedHtml(html);
    
    // Validate content quality
    if (!isContentValid(truncatedText, title)) {
      throw new Error(`Content does not meet quality thresholds: title length ${title.length}, content length ${truncatedText.length}`);
    }
    
    const processingMetadata = getProcessingMetadata(text, html, truncatedText, truncatedHtml);
    
    console.log(`[DEBUG] Content processing:`, {
      original_sizes: { text: text.length, html: html.length },
      processed_sizes: { text: truncatedText.length, html: truncatedHtml.length },
      truncated: { content: processingMetadata.content_truncated, html: processingMetadata.html_truncated }
    });
    
    console.log(`[DEBUG] Document data:`, {
      folder_id: folderId,
      title,
      source_url: url,
      content_length: truncatedText.length,
      content_hash: contentHash,
      document_type: 'gov_crawled',
      language
    });
    
    // Check if document exists with same source_url and content_hash
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
          content: truncatedText,
          raw_content: truncatedHtml,
          content_hash: contentHash,
          language,
          trust_level: source.metadata?.trust_level || 1.0,
          last_crawled_at: new Date().toISOString(),
          metadata: {
            ...source.metadata,
            page_type: detectPageType(title, text),
            images_alt_texts: imageAlts,
            tables: tables,
            extraction_stats: {
              images_count: imageAlts.length,
              tables_count: tables.length
            },
            processing: processingMetadata
          }
        })
        .eq('id', existingDoc.id)
        .select()
        .single();
      
      document = result.data;
      docError = result.error;
    } else {
      // Insert new document
      console.log(`[DEBUG] Inserting new document`);
      const result = await supabase
        .from('kb_documents')
        .insert({
          folder_id: folderId,
          user_id: null,
          title,
          content: truncatedText,
          raw_content: truncatedHtml,
          content_hash: contentHash,
          document_type: 'gov_crawled',
          source_url: url,
          language,
          trust_level: source.metadata?.trust_level || 1.0,
          last_crawled_at: new Date().toISOString(),
          metadata: {
            ...source.metadata,
            page_type: detectPageType(title, text),
            images_alt_texts: imageAlts,
            tables: tables,
            extraction_stats: {
              images_count: imageAlts.length,
              tables_count: tables.length
            },
            processing: processingMetadata
          }
        })
        .select()
        .single();
      
      document = result.data;
      docError = result.error;
      
      // If we inserted a new document but there were old ones, clean up old versions
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

    // 9. Semantic Chunking (RAG Optimized)
    console.log(`[STEP 9] Creating semantic chunks...`);
    
    const semanticChunker = new SemanticChunker({
      target_chunk_size: 500,
      max_chunk_size: 600,
      min_chunk_size: 200,
      overlap_size: 100,
      preserve_boundaries: true,
      include_context: true,
      split_long_paragraphs: true
    });
    
    semanticChunkingResult = semanticChunker.chunkWithStructure(documentStructure);
    
    console.log(`[STEP 9] Created ${semanticChunkingResult.chunks.length} semantic chunks`);
    console.log(`[STEP 9] Chunking method: ${semanticChunkingResult.metadata.chunking_method}, avg size: ${semanticChunkingResult.metadata.avg_chunk_size} tokens`);
    console.log(`[STEP 9] Boundary preservation: ${semanticChunkingResult.metadata.boundary_preservation}%`);

    // 10. Enhanced Metadata Generation
    console.log(`[STEP 10] Generating enhanced metadata...`);
    
    const enhancedChunks = [];
    for (let i = 0; i < semanticChunkingResult.chunks.length; i++) {
      const chunk = semanticChunkingResult.chunks[i];
      
      const enhancedMetadata = generateMetadata(
        chunk,
        documentStructure,
        url,
        source.name
      );
      
      enhancedChunks.push({
        ...chunk,
        enhanced_metadata: enhancedMetadata
      });
    }
    
    console.log(`[STEP 10] Enhanced metadata generated for ${enhancedChunks.length} chunks`);

    // 11. Delete old chunks
    console.log(`[STEP 11] Deleting old chunks...`);
    const { error: deleteError } = await supabase
      .from('document_chunks')
      .delete()
      .eq('document_id', document.id);

    if (deleteError) {
      console.error(`[WARNING] Failed to delete old chunks:`, deleteError);
    } else {
      console.log(`[STEP 11] Old chunks deleted`);
    }

    // 12. Store enhanced chunks in database (without embeddings initially)
    console.log(`[STEP 12] Storing enhanced chunks in database...`);
    const storedChunks: Array<{ id: string; chunk_text: string }> = [];
    
    for (let i = 0; i < enhancedChunks.length; i++) {
      const chunk = enhancedChunks[i];
      
      if (i % 10 === 0) {
        console.log(`[STEP 12] Storing chunk ${i + 1}/${enhancedChunks.length}...`);
      }

      const { data: storedChunk, error: chunkError } = await supabase
        .from('document_chunks')
        .insert({
          document_id: document.id,
          page_id: page.id,
          chunk_text: chunk.text,
          chunk_index: i,
          chunk_hash: createHash('sha256').update(chunk.text).digest('hex'),
          embedding_small: null, // Will be filled by async processing
          embedding_large: null, // Will be filled by async processing
          token_count: chunk.tokens,
          section_heading: chunk.metadata.source_section,
          section_level: chunk.metadata.section_level,
          is_section_chunk: chunk.type === 'section',
          metadata: {
            ...chunk.metadata,
            enhanced_metadata: chunk.enhanced_metadata,
            chunk_type: chunk.type,
            semantic_boundaries: chunk.metadata.semantic_boundaries,
            topic_keywords: chunk.metadata.topic_keywords
          }
        })
        .select('id')
        .single();

      if (chunkError) {
        console.error(`[ERROR] Failed to insert chunk ${i}:`, chunkError);
        throw chunkError;
      }

      storedChunks.push({
        id: storedChunk.id,
        chunk_text: chunk.text
      });
    }

    // 13. Update document with chunk IDs
    console.log(`[STEP 13] Updating document with chunk references...`);
    const chunkIds = storedChunks.map(chunk => chunk.id);
    
    await supabase
      .from('kb_documents')
      .update({
        document_chunks: chunkIds,
        embeddings_updated_at: null // Will be set when embeddings are complete
      })
      .eq('id', document.id);

    // 14. Enqueue chunks for async embedding processing
    console.log(`[STEP 14] Enqueueing chunks for async embedding processing...`);
    const embeddingQueue = getEmbeddingQueue();
    
    await embeddingQueue.enqueueChunks(
      document.id,
      storedChunks,
      'normal' // Priority: high, normal, low
    );

    console.log(`[SUCCESS] Completed: ${url} (${enhancedChunks.length} semantic chunks, embeddings queued)`);

    // Optional: Process embeddings immediately for high-priority documents
    if (source.metadata?.priority === 'high') {
      console.log(`[STEP 15] Processing embeddings immediately for high-priority document...`);
      await embeddingQueue.processDocumentJobs(document.id);
      
      // Update embeddings_updated_at timestamp
      await supabase
        .from('kb_documents')
        .update({ embeddings_updated_at: new Date().toISOString() })
        .eq('id', document.id);
    }

    // 16. Detect and enqueue discovered links (pagination + all internal links)
    console.log(`[STEP 16] Discovering links from page...`);
    const $ = cheerio.load(html);
    
    // Get all discovered links from this page
    const discoveredLinks = discoverAllLinks($, url, source.base_url);
    console.log(`[STEP 16] Found ${discoveredLinks.length} total links on page`);
    
    // Get already crawled URLs to avoid duplicates
    const { data: existingPages } = await supabase
      .from('crawler_pages')
      .select('url')
      .eq('source_id', sourceId)
      .in('url', discoveredLinks);
    
    const existingUrls = new Set(existingPages?.map(p => p.url) || []);
    const newLinks = discoveredLinks.filter(link => !existingUrls.has(link));
    
    console.log(`[STEP 16] ${existingUrls.size} already crawled, ${newLinks.length} new links to enqueue`);
    
    // Enqueue new links
    if (newLinks.length > 0) {
      const { enqueueCrawlJob } = await import('../qstash/client');
      
      // Limit to prevent overwhelming the queue
      const linksToEnqueue = newLinks.slice(0, 50);
      
      for (const linkUrl of linksToEnqueue) {
        try {
          await enqueueCrawlJob(linkUrl, sourceId);
          console.log(`[LINKS] Enqueued: ${linkUrl}`);
        } catch (error) {
          console.error(`[LINKS] Failed to enqueue ${linkUrl}:`, error);
        }
      }
      
      if (newLinks.length > 50) {
        console.log(`[LINKS] Skipped ${newLinks.length - 50} links (limit: 50 per page)`);
      }
    }

    const duration = Date.now() - startTime;

    // Log metrics
    console.log(`[STEP 17] Logging metrics...`);
    await logCrawlMetrics({
      url,
      status: 'success',
      duration_ms: duration,
      chunks_created: enhancedChunks.length,
      extraction_method: extracted.extraction_method,
      extraction_confidence: extracted.confidence
    });

    console.log(`[COMPLETE] Total processing time: ${duration}ms`);

    return {
      status: 'success',
      url,
      chunks: enhancedChunks.length,
      extraction_method: extracted.extraction_method,
      extraction_confidence: extracted.confidence,
      duration_ms: duration,
      links_discovered: discoveredLinks.length,
      links_enqueued: newLinks.length,
      images_processed: imageAlts.length,
      tables_processed: tables.length,
      processing_pipeline: {
        html_cleaning_method: cleaningResult.metadata.extractionMethod,
        content_score: cleaningResult.metadata.contentScore,
        structure_type: documentStructure.metadata.structureType,
        sections_found: documentStructure.metadata.totalSections,
        chunking_method: semanticChunkingResult.metadata.chunking_method,
        avg_chunk_size: semanticChunkingResult.metadata.avg_chunk_size,
        boundary_preservation: semanticChunkingResult.metadata.boundary_preservation
      }
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
      user_id: null
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

function extractTables($: cheerio.CheerioAPI): Array<{
  headers: string[];
  rows: string[][];
  caption?: string;
  summary?: string;
  tableType: 'simple' | 'complex' | 'nested';
  metadata: {
    rowCount: number;
    columnCount: number;
    hasRowSpan: boolean;
    hasColSpan: boolean;
    hasNestedTables: boolean;
  };
}> {
  const tables: Array<{
    headers: string[];
    rows: string[][];
    caption?: string;
    summary?: string;
    tableType: 'simple' | 'complex' | 'nested';
    metadata: {
      rowCount: number;
      columnCount: number;
      hasRowSpan: boolean;
      hasColSpan: boolean;
      hasNestedTables: boolean;
    };
  }> = [];

  $('table').each((i, table) => {
    const $table = $(table);
    const headers: string[] = [];
    const rows: string[][] = [];
    
    // Extract caption and summary
    const caption = $table.find('caption').text().trim() || undefined;
    const summary = $table.attr('summary') || undefined;
    
    // Detect table complexity
    const hasRowSpan = $table.find('[rowspan]').length > 0;
    const hasColSpan = $table.find('[colspan]').length > 0;
    const hasNestedTables = $table.find('table').length > 0;
    
    let tableType: 'simple' | 'complex' | 'nested' = 'simple';
    if (hasNestedTables) {
      tableType = 'nested';
    } else if (hasRowSpan || hasColSpan) {
      tableType = 'complex';
    }
    
    // Extract headers
    let headerRow = $table.find('thead tr').first();
    if (headerRow.length === 0) {
      headerRow = $table.find('tr').first();
    }
    
    if (headerRow.length > 0) {
      headerRow.find('th, td').each((j, cell) => {
        const $cell = $(cell);
        let cellText = $cell.text().trim();
        const colspan = parseInt($cell.attr('colspan') || '1');
        headers.push(cellText);
        
        for (let k = 1; k < colspan; k++) {
          headers.push('');
        }
      });
    }
    
    // Extract data rows
    const dataRows = $table.find('tbody tr').length > 0 
      ? $table.find('tbody tr')
      : $table.find('tr').slice(headers.length > 0 ? 1 : 0);
    
    dataRows.each((j, row) => {
      const $row = $(row);
      const rowData: string[] = [];
      
      $row.find('td, th').each((k, cell) => {
        const $cell = $(cell);
        let cellText = $cell.text().trim();
        
        if ($cell.find('a').length > 0) {
          const links = $cell.find('a').map((l, link) => {
            const href = $(link).attr('href');
            const text = $(link).text().trim();
            return href ? `${text} (${href})` : text;
          }).get();
          cellText = links.join(', ');
        }
        
        if ($cell.find('ul, ol').length > 0) {
          const listItems = $cell.find('li').map((l, li) => $(li).text().trim()).get();
          cellText = listItems.join('; ');
        }
        
        const colspan = parseInt($cell.attr('colspan') || '1');
        rowData.push(cellText);
        
        for (let l = 1; l < colspan; l++) {
          rowData.push('');
        }
      });
      
      if (rowData.some(cell => cell.length > 0)) {
        rows.push(rowData);
      }
    });
    
    const rowCount = rows.length;
    const columnCount = Math.max(headers.length, ...rows.map(row => row.length));
    
    if (headers.length > 0 || rows.length > 0) {
      tables.push({
        headers,
        rows,
        caption,
        summary,
        tableType,
        metadata: {
          rowCount,
          columnCount,
          hasRowSpan,
          hasColSpan,
          hasNestedTables
        }
      });
    }
  });

  return tables;
}

function detectPaginationLinks($: cheerio.CheerioAPI, currentUrl: string): string[] {
  const paginationUrls: string[] = [];
  const baseUrl = new URL(currentUrl).origin;
  
  const paginationSelectors = [
    'a[href*="page"]',
    'a[href*="halaman"]', 
    '.pagination a',
    '.pager a',
    'a:contains("Next")',
    'a:contains("Seterusnya")',
    'a:contains(">")',
    'a[rel="next"]'
  ];
  
  paginationSelectors.forEach(selector => {
    $(selector).each((i, elem) => {
      const href = $(elem).attr('href');
      if (href) {
        try {
          const url = href.startsWith('http') ? href : new URL(href, baseUrl).toString();
          if (url !== currentUrl && !paginationUrls.includes(url)) {
            paginationUrls.push(url);
          }
        } catch (e) {
          // Invalid URL, skip
        }
      }
    });
  });
  
  return paginationUrls.slice(0, 5);
}

/**
 * Discover all internal links from a page
 * Used for recursive crawling of sites without sitemap
 */
function discoverAllLinks($: cheerio.CheerioAPI, currentUrl: string, baseUrl: string): string[] {
  const links: string[] = [];
  const baseOrigin = new URL(baseUrl).origin;
  const currentOrigin = new URL(currentUrl).origin;
  
  $('a[href]').each((i, elem) => {
    const href = $(elem).attr('href');
    if (!href) return;
    
    try {
      // Skip empty, javascript, mailto, and anchor links
      if (href.startsWith('javascript:') || 
          href.startsWith('mailto:') || 
          href.startsWith('#') ||
          href.trim() === '') {
        return;
      }
      
      // Resolve relative URLs
      let fullUrl: string;
      if (href.startsWith('http://') || href.startsWith('https://')) {
        fullUrl = href;
      } else {
        fullUrl = new URL(href, currentUrl).toString();
      }
      
      // Check if it's an internal link (same domain)
      const urlObj = new URL(fullUrl);
      const isInternal = urlObj.origin === baseOrigin || urlObj.origin === currentOrigin;
      
      // Skip if not internal or same as current URL
      if (!isInternal || fullUrl === currentUrl) {
        return;
      }
      
      // Skip non-HTML URLs (images, PDFs, etc.)
      const path = urlObj.pathname.toLowerCase();
      if (path.endsWith('.png') || 
          path.endsWith('.jpg') || 
          path.endsWith('.jpeg') || 
          path.endsWith('.gif') || 
          path.endsWith('.svg') ||
          path.endsWith('.pdf') ||
          path.endsWith('.zip') ||
          path.endsWith('.css') ||
          path.endsWith('.js') ||
          path.endsWith('.xml') ||
          path.endsWith('.json')) {
        return;
      }
      
      // Add to links if not already present
      if (!links.includes(fullUrl)) {
        links.push(fullUrl);
      }
    } catch (e) {
      // Invalid URL, skip
    }
  });
  
  return links;
}