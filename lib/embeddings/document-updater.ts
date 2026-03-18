/**
 * Document embedding updater utility
 * Handles updating embeddings for kb_documents when content changes
 */

import { createClient } from '@/lib/supabase/server';
import { generateDualEmbeddings } from './generator';
import { createHash } from 'crypto';

export interface EmbeddingUpdateStats {
  processed: number;
  updated: number;
  errors: number;
  chunks_created: number;
  chunks_updated: number;
  chunks_removed: number;
}

/**
 * Update embeddings for a specific document
 */
export async function updateDocumentEmbeddings(
  documentId: string
): Promise<EmbeddingUpdateStats> {
  const supabase = await createClient();
  const stats: EmbeddingUpdateStats = {
    processed: 0,
    updated: 0,
    errors: 0,
    chunks_created: 0,
    chunks_updated: 0,
    chunks_removed: 0
  };

  try {
    // Get the document
    const { data: doc, error: docError } = await supabase
      .from('kb_documents')
      .select(`
        id,
        title,
        content,
        content_hash,
        updated_at,
        embeddings_updated_at
      `)
      .eq('id', documentId)
      .single();

    if (docError) throw docError;
    if (!doc) throw new Error('Document not found');

    await processDocumentEmbeddings(supabase, doc, stats);
    
    return stats;
  } catch (error) {
    console.error(`[EMBEDDING-UPDATER] Error updating document ${documentId}:`, error);
    stats.errors++;
    return stats;
  }
}

/**
 * Update embeddings for all documents that need updates
 */
export async function updateAllDocumentEmbeddings(): Promise<EmbeddingUpdateStats> {
  const supabase = await createClient();
  const stats: EmbeddingUpdateStats = {
    processed: 0,
    updated: 0,
    errors: 0,
    chunks_created: 0,
    chunks_updated: 0,
    chunks_removed: 0
  };

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
        embeddings_updated_at
      `)
      .not('content', 'is', null);

    if (docsError) throw docsError;

    const documentsNeedingUpdate = (documents || []).filter((doc: any) => {
      if (!doc.embeddings_updated_at) return true;
      if (!doc.updated_at) return false;
      return new Date(doc.updated_at) > new Date(doc.embeddings_updated_at);
    });

    if (documentsNeedingUpdate.length === 0) {
      console.log('[EMBEDDING-UPDATER] No documents need embedding updates');
      return stats;
    }

    console.log(`[EMBEDDING-UPDATER] Found ${documentsNeedingUpdate.length} documents needing updates`);

    // Process documents
    for (const doc of documentsNeedingUpdate) {
      try {
        await processDocumentEmbeddings(supabase, doc, stats);
      } catch (error) {
        console.error(`[EMBEDDING-UPDATER] Error processing document ${doc.id}:`, error);
        stats.errors++;
      }
    }

    return stats;
  } catch (error) {
    console.error('[EMBEDDING-UPDATER] Error in updateAllDocumentEmbeddings:', error);
    stats.errors++;
    return stats;
  }
}
/**
 * Process embeddings for a single document
 */
async function processDocumentEmbeddings(
  supabase: any,
  doc: any,
  stats: EmbeddingUpdateStats
) {
  console.log(`[EMBEDDING-UPDATER] Processing document: ${doc.title}`);
  
  if (!doc.content) {
    console.log(`[EMBEDDING-UPDATER] Skipping document ${doc.id} - no content`);
    return;
  }

  // Generate content hash to check if content changed
  const currentContentHash = createHash('sha256')
    .update(doc.content)
    .digest('hex');

  // Check if content actually changed
  if (doc.content_hash === currentContentHash && doc.embeddings_updated_at) {
    console.log(`[EMBEDDING-UPDATER] Document ${doc.id} content unchanged, skipping`);
    return;
  }

  stats.processed++;

  // Split content into chunks
  const chunks = splitIntoChunks(doc.content);
  console.log(`[EMBEDDING-UPDATER] Split into ${chunks.length} chunks`);

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
    console.log(`[EMBEDDING-UPDATER] Generating embeddings for chunk ${i}`);
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
      stats.chunks_updated++;
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
      stats.chunks_created++;
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
    
    stats.chunks_removed += chunksToRemove.length;
    console.log(`[EMBEDDING-UPDATER] Removed ${chunksToRemove.length} old chunks`);
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

  console.log(`[EMBEDDING-UPDATER] ✅ Updated document ${doc.id}: ${stats.chunks_created} created, ${stats.chunks_updated} updated, ${stats.chunks_removed} removed`);
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

/**
 * Force update embeddings for a document (ignores content_hash check)
 */
export async function forceUpdateDocumentEmbeddings(
  documentId: string
): Promise<EmbeddingUpdateStats> {
  const supabase = await createClient();
  const stats: EmbeddingUpdateStats = {
    processed: 0,
    updated: 0,
    errors: 0,
    chunks_created: 0,
    chunks_updated: 0,
    chunks_removed: 0
  };

  try {
    // Get the document
    const { data: doc, error: docError } = await supabase
      .from('kb_documents')
      .select(`
        id,
        title,
        content,
        content_hash,
        updated_at,
        embeddings_updated_at
      `)
      .eq('id', documentId)
      .single();

    if (docError) throw docError;
    if (!doc) throw new Error('Document not found');

    // Temporarily clear content_hash to force update
    const originalContentHash = doc.content_hash;
    doc.content_hash = null;

    await processDocumentEmbeddings(supabase, doc, stats);
    
    return stats;
  } catch (error) {
    console.error(`[EMBEDDING-UPDATER] Error force updating document ${documentId}:`, error);
    stats.errors++;
    return stats;
  }
}
