/**
 * QStash webhook endpoint
 * Receives and processes crawl jobs from QStash queue
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifySignatureAppRouter } from '@upstash/qstash/nextjs';
import { processPage } from '@/lib/crawler/processor';
import { getEmbeddingQueue } from '@/lib/queue/embedding-queue';

export const maxDuration = 300;

async function handler(req: NextRequest) {
  const startTime = Date.now();
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  try {
    const body = await req.json();
    const { type, url, sourceId } = body;

    if (!type || !url || !sourceId) {
      console.error(`[WEBHOOK:${requestId}] Missing required fields`);
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    if (type === 'crawl') {
      const embeddingQueue = getEmbeddingQueue();
      const initialQueueStats = await embeddingQueue.getQueueStats();
      
      const result = await processPage(url, sourceId, { 
        depth: body.depth ?? 0, 
        maxDepth: body.maxDepth ?? 3 
      });
      
      const finalQueueStats = await embeddingQueue.getQueueStats();
      const queueDelta = {
        pending: finalQueueStats.pending - initialQueueStats.pending,
        total: finalQueueStats.total - initialQueueStats.total
      };
      
      return NextResponse.json({
        success: true,
        message: `Processed ${url}`,
        result: {
          ...result,
          embeddingQueue: {
            initial: initialQueueStats,
            final: finalQueueStats,
            added: queueDelta
          }
        },
        duration_ms: Date.now() - startTime
      });
    }

    console.error(`[WEBHOOK:${requestId}] Unknown job type: ${type}`);
    return NextResponse.json({ error: 'Unknown job type' }, { status: 400 });

  } catch (error: any) {
    const totalDuration = Date.now() - startTime;
    console.error(`[WEBHOOK:${requestId}] Error:`, error.message);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error' },
      { status: 500 }
    );
  }
}

export const POST = verifySignatureAppRouter(handler);