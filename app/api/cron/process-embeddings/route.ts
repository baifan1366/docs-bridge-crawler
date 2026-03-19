/**
 * Cron job to process embedding queue
 * Runs daily at 4 AM to process all pending embedding jobs
 */

import { NextRequest, NextResponse } from 'next/server';
import { getEmbeddingQueue } from '@/lib/queue/embedding-queue';

const BATCH_SIZE = 100;

export async function GET(request: NextRequest) {
  const startTime = Date.now();
  
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    console.error('[CRON-EMBEDDINGS] Unauthorized');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const embeddingQueue = getEmbeddingQueue();
    let initialStats = await embeddingQueue.getQueueStats();

    if (initialStats.pending === 0) {
      return NextResponse.json({
        message: 'No pending jobs',
        stats: initialStats,
        duration_ms: Date.now() - startTime
      });
    }

    let totalProcessed = 0;
    let batchesProcessed = 0;

    // Process all pending jobs in a loop
    while (true) {
      const currentStats = await embeddingQueue.getQueueStats();
      
      if (currentStats.pending === 0) {
        break;
      }

      const batchSize = Math.min(currentStats.pending, BATCH_SIZE);
      await embeddingQueue.processQueue(batchSize);
      
      totalProcessed += batchSize;
      batchesProcessed++;
    }

    const finalStats = await embeddingQueue.getQueueStats();

    // Cleanup old jobs
    await embeddingQueue.cleanupCompletedJobs(7);

    return NextResponse.json({
      message: 'Completed',
      total_processed: totalProcessed,
      batches_processed: batchesProcessed,
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