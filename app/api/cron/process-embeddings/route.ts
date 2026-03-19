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

const BATCH_SIZE = 100;

async function scheduleFollowUp(delaySeconds: number = 60) {
  const baseUrl = process.env.VERCEL_URL 
    ? `https://${process.env.VERCEL_URL}`
    : process.env.NEXT_PUBLIC_SITE_URL || 'https://your-domain.com';
  
  const url = `${baseUrl}/api/cron/process-embeddings`;

  try {
    await qstash.publishJSON({
      url,
      body: {},
      retries: 0,
      delay: delaySeconds,
      headers: {
        'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET || ''
      }
    });
  } catch (error) {
    console.error('[CRON-EMBEDDINGS] Failed to schedule follow-up:', error);
    throw error;
  }
}

export async function GET(request: NextRequest) {
  const startTime = Date.now();
  
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
        stats: initialStats,
        duration_ms: Date.now() - startTime
      });
    }

    const batchSize = Math.min(initialStats.pending, BATCH_SIZE);
    await embeddingQueue.processQueue(batchSize);

    const finalStats = await embeddingQueue.getQueueStats();

    if (finalStats.pending > 0) {
      await scheduleFollowUp(30);
    }

    const shouldCleanup = Math.random() < 0.1;
    if (shouldCleanup) {
      await embeddingQueue.cleanupCompletedJobs(7);
    }

    return NextResponse.json({
      message: 'Completed',
      processed_batch_size: batchSize,
      initial_stats: initialStats,
      final_stats: finalStats,
      has_more: finalStats.pending > 0,
      cleanup_performed: shouldCleanup,
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