/**
 * Cron job to process embedding queue
 * Runs daily at 4 AM to process pending embedding jobs
 * Call manually to process batches
 */

import { NextRequest, NextResponse } from 'next/server';
import { getEmbeddingQueue } from '@/lib/queue/embedding-queue';

export const maxDuration = 300; // Vercel max

const BATCH_SIZE = 20;
const MAX_BATCHES = 100;

async function processBatch(embeddingQueue: any): Promise<{ processed: number; hasMore: boolean }> {
  const currentStats = await embeddingQueue.getQueueStats();
  
  if (currentStats.pending === 0) {
    return { processed: 0, hasMore: false };
  }

  const batchSize = Math.min(currentStats.pending, BATCH_SIZE);
  await embeddingQueue.processQueue(batchSize);
  
  return { processed: batchSize, hasMore: true };
}

export async function GET(request: NextRequest) {
  const startTime = Date.now();
  const searchParams = request.nextUrl.searchParams;
  const batchNum = parseInt(searchParams.get('batch') || '1');
  const maxBatches = parseInt(searchParams.get('max_batches') || String(MAX_BATCHES));
  
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    console.error('[CRON-EMBEDDINGS] Unauthorized');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  console.log(`[CRON-EMBEDDINGS] Batch ${batchNum}/${maxBatches} starting...`);

  try {
    const embeddingQueue = getEmbeddingQueue();
    const initialStats = await embeddingQueue.getQueueStats();

    if (initialStats.pending === 0) {
      console.log('[CRON-EMBEDDINGS] No pending jobs');
      return NextResponse.json({
        message: 'No pending jobs',
        batch: batchNum,
        stats: initialStats,
        duration_ms: Date.now() - startTime
      });
    }

    const { processed, hasMore } = await processBatch(embeddingQueue);
    console.log(`[CRON-EMBEDDINGS] Batch ${batchNum}: processed ${processed} jobs`);

    const finalStats = await embeddingQueue.getQueueStats();
    await embeddingQueue.cleanupCompletedJobs(7);

    return NextResponse.json({
      message: 'Completed',
      batch: batchNum,
      processed_in_batch: processed,
      has_more: hasMore && batchNum < maxBatches,
      remaining: finalStats.pending,
      initial_stats: initialStats,
      final_stats: finalStats,
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