/**
 * Cron job to process embedding queue
 * Runs daily at 4 AM to process all pending embedding jobs
 * Self-calls to continue processing until queue is empty
 */

import { NextRequest, NextResponse } from 'next/server';
import { getEmbeddingQueue } from '@/lib/queue/embedding-queue';

export const maxDuration = 300; // Vercel max

const BATCH_SIZE = 50;
const MAX_BATCHES = 5;
const SELF_CALL_DELAY_MS = 2000; // 2 seconds between batches

async function processBatch(embeddingQueue: any, batchNum: number, maxBatches: number): Promise<{ processed: number; hasMore: boolean }> {
  const currentStats = await embeddingQueue.getQueueStats();
  
  if (currentStats.pending === 0) {
    return { processed: 0, hasMore: false };
  }

  const batchSize = Math.min(currentStats.pending, BATCH_SIZE);
  await embeddingQueue.processQueue(batchSize);
  
  return { processed: batchSize, hasMore: batchNum < maxBatches };
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

  try {
    const embeddingQueue = getEmbeddingQueue();
    const initialStats = await embeddingQueue.getQueueStats();

    if (initialStats.pending === 0) {
      return NextResponse.json({
        message: 'No pending jobs',
        batch: batchNum,
        stats: initialStats,
        duration_ms: Date.now() - startTime
      });
    }

    // Process this batch
    const { processed, hasMore } = await processBatch(embeddingQueue, batchNum, maxBatches);

    if (hasMore && batchNum < maxBatches) {
      // Self-call to continue with next batch
      const baseUrl = process.env.VERCEL_URL 
        ? `https://${process.env.VERCEL_URL}`
        : process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
      
      const nextUrl = `${baseUrl}/api/cron/process-embeddings?batch=${batchNum + 1}&max_batches=${maxBatches}`;
      
      // Call next batch after a delay
      setTimeout(async () => {
        try {
          await fetch(nextUrl, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${process.env.CRON_SECRET}` }
          });
        } catch (error) {
          console.error('[CRON-EMBEDDINGS] Self-call failed:', error);
        }
      }, SELF_CALL_DELAY_MS);
    }

    const finalStats = await embeddingQueue.getQueueStats();

    // Cleanup old jobs
    await embeddingQueue.cleanupCompletedJobs(7);

    return NextResponse.json({
      message: hasMore ? 'Batch processed, continuing...' : 'Completed',
      batch: batchNum,
      processed_in_batch: processed,
      has_more: hasMore,
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