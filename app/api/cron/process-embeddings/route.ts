/**
 * Cron job to process embedding queue
 * Runs daily at 4 AM to process pending embedding jobs
 */

import { NextRequest, NextResponse } from 'next/server';
import { getEmbeddingQueue } from '@/lib/queue/embedding-queue';

export async function GET(request: NextRequest) {
  const startTime = Date.now();
  
  // Verify Vercel Cron request
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    console.error('[CRON-EMBEDDINGS] Unauthorized access attempt');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  console.log('[CRON-EMBEDDINGS] Starting embedding queue processing...');

  try {
    const embeddingQueue = getEmbeddingQueue();

    // Get initial stats
    const initialStats = await embeddingQueue.getQueueStats();
    console.log('[CRON-EMBEDDINGS] Initial queue stats:', initialStats);

    if (initialStats.pending === 0) {
      console.log('[CRON-EMBEDDINGS] No pending jobs, skipping processing');
      return NextResponse.json({
        message: 'No pending embedding jobs',
        stats: initialStats,
        duration_ms: Date.now() - startTime,
        timestamp: new Date().toISOString()
      });
    }

    // Process queue with larger batch size for cron job
    const batchSize = Math.min(initialStats.pending, 20); // Process up to 20 jobs
    await embeddingQueue.processQueue(batchSize);

    // Get final stats
    const finalStats = await embeddingQueue.getQueueStats();
    console.log('[CRON-EMBEDDINGS] Final queue stats:', finalStats);

    // Cleanup old completed jobs (once per day, roughly)
    const shouldCleanup = Math.random() < 0.1; // 10% chance
    if (shouldCleanup) {
      console.log('[CRON-EMBEDDINGS] Performing cleanup of old jobs...');
      await embeddingQueue.cleanupCompletedJobs(7);
    }

    const duration = Date.now() - startTime;
    console.log(`[CRON-EMBEDDINGS] Completed in ${duration}ms`);

    return NextResponse.json({
      message: 'Embedding queue processing completed',
      processed_batch_size: batchSize,
      initial_stats: initialStats,
      final_stats: finalStats,
      cleanup_performed: shouldCleanup,
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