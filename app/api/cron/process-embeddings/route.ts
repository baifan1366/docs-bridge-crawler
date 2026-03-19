/**
 * Cron job to process embedding queue
 * Runs daily at 4 AM to process all pending embedding jobs
 * Triggers next batch before returning response
 */

import { NextRequest, NextResponse } from 'next/server';
import { getEmbeddingQueue } from '@/lib/queue/embedding-queue';

export const maxDuration = 300; // Vercel max

const BATCH_SIZE = 50;
const MAX_BATCHES = 5;

async function processBatch(embeddingQueue: any): Promise<{ processed: number; hasMore: boolean }> {
  const currentStats = await embeddingQueue.getQueueStats();
  
  if (currentStats.pending === 0) {
    return { processed: 0, hasMore: false };
  }

  const batchSize = Math.min(currentStats.pending, BATCH_SIZE);
  await embeddingQueue.processQueue(batchSize);
  
  return { processed: batchSize, hasMore: true };
}

function triggerNextBatch(baseUrl: string, nextBatch: number, maxBatches: number): void {
  const url = `${baseUrl}/api/cron/process-embeddings?batch=${nextBatch}&max_batches=${maxBatches}`;
  
  // Fire and forget - Vercel will keep process alive long enough for fetch to start
  fetch(url, {
    method: 'GET',
    headers: { 
      'Authorization': `Bearer ${process.env.CRON_SECRET}`,
      'Content-Type': 'application/json'
    }
  }).then(response => {
    if (response.ok) {
      console.log(`[CRON-EMBEDDINGS] Next batch ${nextBatch} triggered successfully`);
    } else {
      console.error(`[CRON-EMBEDDINGS] Next batch ${nextBatch} failed: ${response.status}`);
    }
  }).catch(error => {
    console.error(`[CRON-EMBEDDINGS] Next batch ${nextBatch} error:`, error);
  });
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

    // Process this batch
    const { processed, hasMore } = await processBatch(embeddingQueue);
    console.log(`[CRON-EMBEDDINGS] Batch ${batchNum}: processed ${processed} jobs`);

    const finalStats = await embeddingQueue.getQueueStats();

    // Cleanup old jobs
    await embeddingQueue.cleanupCompletedJobs(7);

    // Trigger next batch before returning
    if (hasMore && batchNum < maxBatches) {
      const baseUrl = process.env.VERCEL_URL 
        ? `https://${process.env.VERCEL_URL}`
        : process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
      
      console.log(`[CRON-EMBEDDINGS] Triggering batch ${batchNum + 1}...`);
      triggerNextBatch(baseUrl, batchNum + 1, maxBatches);
    }

    return NextResponse.json({
      message: hasMore && batchNum < maxBatches ? `Batch ${batchNum} done, batch ${batchNum + 1} triggered` : 'Completed',
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