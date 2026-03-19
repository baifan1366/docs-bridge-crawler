/**
 * Cron job to check and update document embeddings
 * Runs daily at 2 AM
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { generateDualEmbeddings } from '@/lib/embeddings/generator';
import { createHash } from 'crypto';
import { scheduleEmbeddingCheck } from '@/lib/qstash/scheduler';

const BATCH_SIZE = 5;

export async function GET(request: NextRequest) {
  const startTime = Date.now();
  
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    console.error('[CRON-EMBEDDINGS] Unauthorized');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const offset = parseInt(searchParams.get('offset') || '0');

  const supabase = await createClient();

  try {
    const { count: totalCount } = await supabase
      .from('kb_documents')
      .select('*', { count: 'exact', head: true })
      .not('content', 'is', null);

    const { data: documents, error: docsError } = await supabase
      .from('kb_documents')
      .select('id, title, content, content_hash, updated_at, embeddings_updated_at, document_chunks')
      .not('content', 'is', null)
      .range(offset, offset + BATCH_SIZE - 1)
      .order('updated_at', { ascending: false });

    if (docsError) throw docsError;

    const documentsNeedingUpdate = (documents || []).filter((doc: any) => {
      if (!doc.embeddings_updated_at) return true;
      if (!doc.updated_at) return false;
      return new Date(doc.updated_at) > new Date(doc.embeddings_updated_at);
    });

    const hasMore = offset + BATCH_SIZE < (totalCount || 0);

    if (documentsNeedingUpdate.length === 0 && !hasMore) {
      return NextResponse.json({ message: 'No documents to update', remaining: 0 });
    }

    const stats = { processed: 0, updated: 0, errors: 0, chunks_created: 0, chunks_updated: 0, has_more: hasMore };

    for (const doc of documentsNeedingUpdate) {
      try {
        await processDocumentEmbeddings(supabase, doc, stats);
      } catch (error) {
        console.error(`[CRON-EMBEDDINGS] Error processing document ${doc.id}:`, error);
        stats.errors++;
      }
    }

    if (hasMore) {
      await scheduleEmbeddingCheck(offset + BATCH_SIZE);
    }

    return NextResponse.json({
      message: 'Embedding check completed',
      stats,
      duration_ms: Date.now() - startTime
    });

  } catch (error: any) {
    console.error('[CRON-EMBEDDINGS] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error' },
      { status: 500 }
    );
  }
}

async function processDocumentEmbeddings(supabase: any, doc: any, stats: any) {
  if (!doc.content) return;

  const currentContentHash = createHash('sha256').update(doc.content).digest('hex');

  if (doc.content_hash === currentContentHash && doc.embeddings_updated_at) return;

  stats.processed++;

  const chunks = splitIntoChunks(doc.content);
  const { data: existingChunks, error: chunksError } = await supabase
    .from('document_chunks')
    .select('id, chunk_hash, chunk_index')
    .eq('document_id', doc.id)
    .order('chunk_index');

  if (chunksError) throw chunksError;

  const existingChunkMap = new Map((existingChunks || []).map((chunk: any) => [chunk.chunk_index, chunk]));
  const newChunkIds: string[] = [];
  let chunksCreated = 0;
  let chunksUpdated = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunkText = chunks[i];
    const chunkHash = createHash('sha256').update(chunkText).digest('hex');
    const existingChunk = existingChunkMap.get(i);
    
    if (existingChunk && (existingChunk as any).chunk_hash === chunkHash) {
      newChunkIds.push((existingChunk as any).id);
      continue;
    }

    const { small, large } = await generateDualEmbeddings(chunkText);

    if (existingChunk) {
      await supabase.from('document_chunks').update({
        chunk_text: chunkText,
        chunk_hash: chunkHash,
        embedding_small: small,
        embedding_large: large,
        updated_at: new Date().toISOString()
      }).eq('id', (existingChunk as any).id);
      
      newChunkIds.push((existingChunk as any).id);
      chunksUpdated++;
    } else {
      const { data: newChunk, error: insertError } = await supabase.from('document_chunks').insert({
        document_id: doc.id,
        chunk_text: chunkText,
        chunk_index: i,
        chunk_hash: chunkHash,
        embedding_small: small,
        embedding_large: large,
        token_count: estimateTokenCount(chunkText)
      }).select('id').single();

      if (insertError) throw insertError;
      newChunkIds.push(newChunk.id);
      chunksCreated++;
    }
  }

  const chunksToRemove = (existingChunks || []).filter((chunk: any) => chunk.chunk_index >= chunks.length).map((chunk: any) => chunk.id);
  if (chunksToRemove.length > 0) {
    await supabase.from('document_chunks').delete().in('id', chunksToRemove);
  }

  await supabase.from('kb_documents').update({
    document_chunks: newChunkIds,
    content_hash: currentContentHash,
    embeddings_updated_at: new Date().toISOString()
  }).eq('id', doc.id);

  stats.updated++;
  stats.chunks_created += chunksCreated;
  stats.chunks_updated += chunksUpdated;
}

function splitIntoChunks(content: string, maxChunkSize: number = 1000): string[] {
  const chunks: string[] = [];
  const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);
  let currentChunk = '';
  
  for (const sentence of sentences) {
    const trimmedSentence = sentence.trim();
    if (!trimmedSentence) continue;
    
    if (currentChunk.length + trimmedSentence.length > maxChunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      currentChunk = trimmedSentence;
    } else {
      currentChunk += (currentChunk ? '. ' : '') + trimmedSentence;
    }
  }
  
  if (currentChunk.trim()) chunks.push(currentChunk.trim());
  if (chunks.length === 0 && content.trim()) chunks.push(content.trim());
  
  return chunks;
}

function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}