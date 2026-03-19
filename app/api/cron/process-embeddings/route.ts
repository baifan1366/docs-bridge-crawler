/**
 * Cron job to process embedding queue
 * Runs daily at 4 AM to process pending embedding jobs
 * Call manually to process batches
 */

import { NextRequest, NextResponse } from 'next/server';
import { getEmbeddingQueue } from '@/lib/queue/embedding-queue';

export const maxDuration = 300; // Vercel max

const BATCH_SIZE = 80;
const MAX_BATCHES = 100;

async function processBatch(embeddingQueue: any): Promise<{ processed: number; hasMore: boolean }> {
  const currentStats = await embeddingQueue.getQueueStats();
  
  if (currentStats.pending === 0) {
    return { processed: 0, hasMore: false };
  }

  const batchSize = Math.min(currentStats.pending, BATCH_SIZE);
  await embeddingQueue.processQueue(batchSize);
  
  // Check if there are still pending jobs after processing
  const updatedStats = await embeddingQueue.getQueueStats();
  
  return { 
    processed: batchSize, 
    hasMore: updatedStats.pending > 0 
  };
}

export async function GET(request: NextRequest) {
  const startTime = Date.now();
  const searchParams = request.nextUrl.searchParams;
  const maxBatches = parseInt(searchParams.get('max_batches') || String(MAX_BATCHES));
  
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    console.error('[CRON-EMBEDDINGS] Unauthorized');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  console.log(`[CRON-EMBEDDINGS] Starting processing with max ${maxBatches} batches...`);

  try {
    const embeddingQueue = getEmbeddingQueue();
    const initialStats = await embeddingQueue.getQueueStats();

    if (initialStats.pending === 0) {
      console.log('[CRON-EMBEDDINGS] No pending jobs');
      return NextResponse.json({
        message: 'No pending jobs',
        stats: initialStats,
        duration_ms: Date.now() - startTime
      });
    }

    let totalProcessed = 0;
    let currentBatch = 1;
    let hasMore = true;

    // Process multiple batches in a single cron run
    while (hasMore && currentBatch <= maxBatches) {
      console.log(`[CRON-EMBEDDINGS] Batch ${currentBatch}/${maxBatches} starting...`);
      
      const { processed, hasMore: batchHasMore } = await processBatch(embeddingQueue);
      totalProcessed += processed;
      hasMore = batchHasMore;
      
      console.log(`[CRON-EMBEDDINGS] Batch ${currentBatch}: processed ${processed} jobs`);
      
      if (!hasMore) {
        console.log('[CRON-EMBEDDINGS] No more jobs to process');
        break;
      }
      
      currentBatch++;
      
      // Check if we're approaching Vercel's timeout limit (300s)
      const elapsedTime = Date.now() - startTime;
      if (elapsedTime > 250000) { // 250 seconds, leave 50s buffer
        console.log(`[CRON-EMBEDDINGS] Approaching timeout limit, stopping at batch ${currentBatch - 1}`);
        break;
      }
    }

    const finalStats = await embeddingQueue.getQueueStats();
    await embeddingQueue.cleanupCompletedJobs(7);

    return NextResponse.json({
      message: 'Completed',
      total_batches_processed: currentBatch - 1,
      total_jobs_processed: totalProcessed,
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