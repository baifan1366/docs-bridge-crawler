/**
 * Cron job to process embedding queue
 * Runs daily at 4 AM to process pending embedding jobs
 * Supports pagination to avoid 300s timeout
 */

import { NextRequest, NextResponse } from 'next/server';
import { getEmbeddingQueue } from '@/lib/queue/embedding-queue';
import { Client } from '@upstash/qstash';

const qstash = new Client({
  token: process.env.QSTASH_TOKEN!
});

console.log('[CRON-EMBEDDINGS] QStash client initialized, token exists:', !!process.env.QSTASH_TOKEN);

const BATCH_SIZE = 100;

async function scheduleFollowUp(delaySeconds: number = 60) {
  const baseUrl = process.env.VERCEL_URL 
    ? `https://${process.env.VERCEL_URL}`
    : process.env.NEXT_PUBLIC_SITE_URL || 'https://your-domain.com';
  
  const url = `${baseUrl}/api/cron/process-embeddings`;

  console.log(`[CRON-EMBEDDINGS] Scheduling follow-up in ${delaySeconds}s to ${url}`);

  try {
    const result = await qstash.publishJSON({
      url,
      body: {},
      retries: 0,
      delay: delaySeconds
    });
    console.log(`[CRON-EMBEDDINGS] Follow-up scheduled successfully, messageId: ${result.messageId}`);
  } catch (error) {
    console.error('[CRON-EMBEDDINGS] Failed to schedule follow-up:', error);
    throw error;
  }
}

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

    // Process queue with batch size
    const batchSize = Math.min(initialStats.pending, BATCH_SIZE);
    await embeddingQueue.processQueue(batchSize);

    // Get final stats
    const finalStats = await embeddingQueue.getQueueStats();
    console.log('[CRON-EMBEDDINGS] Final queue stats:', finalStats);

    // Schedule follow-up if there are still pending jobs
    if (finalStats.pending > 0) {
      console.log(`[CRON-EMBEDDINGS] ${finalStats.pending} jobs remaining, scheduling follow-up`);
      await scheduleFollowUp(30);
    }

    // Cleanup old completed jobs (once per day, roughly)
    const shouldCleanup = Math.random() < 0.1;
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
      has_more: finalStats.pending > 0,
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