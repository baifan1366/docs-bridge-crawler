/**
 * Cron job to check and update document embeddings
 * Runs daily at 2 AM to check if kb_documents need embedding updates
 * Note: Hobby accounts are limited to daily cron jobs
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { generateDualEmbeddings } from '@/lib/embeddings/generator';
import { createHash } from 'crypto';

export async function GET(request: NextRequest) {
  const startTime = Date.now();
  
  // Verify Vercel Cron request
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    console.error('[CRON-EMBEDDINGS] Unauthorized access attempt');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  console.log('[CRON-EMBEDDINGS] Starting embedding check...');

  const supabase = await createClient();

  try {
    // Get documents with content (filter needs-update in code; PostgREST can't compare columns)
    const { data: documents, error: docsError } = await supabase
      .from('kb_documents')
      .select(`
        id,
        title,
        content,
        content_hash,
        updated_at,
        embeddings_updated_at,
        document_chunks
      `)
      .not('content', 'is', null);

    if (docsError) throw docsError;

    const documentsNeedingUpdate = (documents || []).filter((doc: any) => {
      if (!doc.embeddings_updated_at) return true;
      if (!doc.updated_at) return false;
      return new Date(doc.updated_at) > new Date(doc.embeddings_updated_at);
    });

    if (documentsNeedingUpdate.length === 0) {
      console.log('[CRON-EMBEDDINGS] No documents need embedding updates');
      return NextResponse.json({ message: 'No documents to update' });
    }

    console.log(`[CRON-EMBEDDINGS] Found ${documentsNeedingUpdate.length} documents needing updates`);

    const stats = {
      processed: 0,
      updated: 0,
      errors: 0,
      chunks_created: 0,
      chunks_updated: 0
    };

    // Process documents in batches to avoid timeout
    const BATCH_SIZE = 5;
    for (let i = 0; i < documentsNeedingUpdate.length; i += BATCH_SIZE) {
      const batch = documentsNeedingUpdate.slice(i, i + BATCH_SIZE);
      
      for (const doc of batch) {
        try {
          await processDocumentEmbeddings(supabase, doc, stats);
        } catch (error) {
          console.error(`[CRON-EMBEDDINGS] Error processing document ${doc.id}:`, error);
          stats.errors++;
        }
      }
      
      // Small delay between batches
      if (i + BATCH_SIZE < documents.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[CRON-EMBEDDINGS] Completed in ${duration}ms`);

    return NextResponse.json({
      message: 'Embedding check completed',
      stats,
      duration_ms: duration,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    const duration = Date.now() - startTime;
    console.error('[CRON-EMBEDDINGS] Error:', error);
    
    return NextResponse.json(
      { 
        error: error instanceof Error ? error.message : 'Unexpected error',
        duration_ms: duration,
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
}

/**
 * Process embeddings for a single document
 */
async function processDocumentEmbeddings(
  supabase: any,
  doc: any,
  stats: any
) {
  console.log(`[CRON-EMBEDDINGS] Processing document: ${doc.title}`);
  
  if (!doc.content) {
    console.log(`[CRON-EMBEDDINGS] Skipping document ${doc.id} - no content`);
    return;
  }

  // Generate content hash to check if content changed
  const currentContentHash = createHash('sha256')
    .update(doc.content)
    .digest('hex');

  // Check if content actually changed
  if (doc.content_hash === currentContentHash && doc.embeddings_updated_at) {
    console.log(`[CRON-EMBEDDINGS] Document ${doc.id} content unchanged, skipping`);
    return;
  }

  stats.processed++;

  // Split content into chunks (simple implementation)
  const chunks = splitIntoChunks(doc.content);
  console.log(`[CRON-EMBEDDINGS] Split into ${chunks.length} chunks`);

  // Get existing chunks for this document
  const { data: existingChunks, error: chunksError } = await supabase
    .from('document_chunks')
    .select('id, chunk_hash, chunk_index')
    .eq('document_id', doc.id)
    .order('chunk_index');

  if (chunksError) throw chunksError;

  const existingChunkMap = new Map(
    (existingChunks || []).map((chunk: any) => [chunk.chunk_index, chunk])
  );

  const newChunkIds: string[] = [];
  let chunksCreated = 0;
  let chunksUpdated = 0;

  // Process each chunk
  for (let i = 0; i < chunks.length; i++) {
    const chunkText = chunks[i];
    const chunkHash = createHash('sha256').update(chunkText).digest('hex');
    
    const existingChunk = existingChunkMap.get(i);
    
    // Skip if chunk hasn't changed
    if (existingChunk && (existingChunk as any).chunk_hash === chunkHash) {
      newChunkIds.push((existingChunk as any).id);
      continue;
    }

    // Generate embeddings for new/changed chunk
    console.log(`[CRON-EMBEDDINGS] Generating embeddings for chunk ${i}`);
    const { small, large } = await generateDualEmbeddings(chunkText);

    if (existingChunk) {
      // Update existing chunk
      const { error: updateError } = await supabase
        .from('document_chunks')
        .update({
          chunk_text: chunkText,
          chunk_hash: chunkHash,
          embedding_small: small,
          embedding_large: large,
          updated_at: new Date().toISOString()
        })
        .eq('id', (existingChunk as any).id);

      if (updateError) throw updateError;
      
      newChunkIds.push((existingChunk as any).id);
      chunksUpdated++;
    } else {
      // Create new chunk
      const { data: newChunk, error: insertError } = await supabase
        .from('document_chunks')
        .insert({
          document_id: doc.id,
          chunk_text: chunkText,
          chunk_index: i,
          chunk_hash: chunkHash,
          embedding_small: small,
          embedding_large: large,
          token_count: estimateTokenCount(chunkText)
        })
        .select('id')
        .single();

      if (insertError) throw insertError;
      
      newChunkIds.push(newChunk.id);
      chunksCreated++;
    }
  }

  // Remove old chunks that are no longer needed
  const chunksToRemove = (existingChunks || [])
    .filter((chunk: any) => chunk.chunk_index >= chunks.length)
    .map((chunk: any) => chunk.id);

  if (chunksToRemove.length > 0) {
    const { error: deleteError } = await supabase
      .from('document_chunks')
      .delete()
      .in('id', chunksToRemove);

    if (deleteError) throw deleteError;
    console.log(`[CRON-EMBEDDINGS] Removed ${chunksToRemove.length} old chunks`);
  }

  // Update document with new chunk IDs and timestamps
  const { error: updateDocError } = await supabase
    .from('kb_documents')
    .update({
      document_chunks: newChunkIds,
      content_hash: currentContentHash,
      embeddings_updated_at: new Date().toISOString()
    })
    .eq('id', doc.id);

  if (updateDocError) throw updateDocError;

  stats.updated++;
  stats.chunks_created += chunksCreated;
  stats.chunks_updated += chunksUpdated;

  console.log(`[CRON-EMBEDDINGS] ✅ Updated document ${doc.id}: ${chunksCreated} created, ${chunksUpdated} updated`);
}

/**
 * Split content into chunks for embedding
 */
function splitIntoChunks(content: string, maxChunkSize: number = 1000): string[] {
  const chunks: string[] = [];
  const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);
  
  let currentChunk = '';
  
  for (const sentence of sentences) {
    const trimmedSentence = sentence.trim();
    if (!trimmedSentence) continue;
    
    // If adding this sentence would exceed max size, start new chunk
    if (currentChunk.length + trimmedSentence.length > maxChunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      currentChunk = trimmedSentence;
    } else {
      currentChunk += (currentChunk ? '. ' : '') + trimmedSentence;
    }
  }
  
  // Add the last chunk if it has content
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }
  
  // If no chunks were created (e.g., very short content), create one chunk
  if (chunks.length === 0 && content.trim()) {
    chunks.push(content.trim());
  }
  
  return chunks;
}

/**
 * Estimate token count for a text (rough approximation)
 */
function estimateTokenCount(text: string): number {
  // Rough estimation: ~4 characters per token for most languages
  return Math.ceil(text.length / 4);
}
