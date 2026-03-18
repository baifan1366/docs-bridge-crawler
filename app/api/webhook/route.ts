/**
 * QStash webhook endpoint
 * Receives and processes crawl jobs from QStash queue
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifySignatureAppRouter } from '@upstash/qstash/nextjs';
import { processPage } from '@/lib/crawler/processor';
import { getEmbeddingQueue } from '@/lib/queue/embedding-queue';

export const maxDuration = 300; // 5 minutes

async function handler(req: NextRequest) {
  const startTime = Date.now();
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  try {
    const body = await req.json();
    const { type, url, sourceId } = body;

    console.log(`[WEBHOOK:${requestId}] 🚀 Starting webhook processing`);
    console.log(`[WEBHOOK:${requestId}] Request details:`, {
      type,
      url,
      sourceId,
      timestamp: new Date().toISOString(),
      userAgent: req.headers.get('user-agent'),
      contentType: req.headers.get('content-type')
    });

    if (!type || !url || !sourceId) {
      console.error(`[WEBHOOK:${requestId}] ❌ Missing required fields:`, {
        type: !!type,
        url: !!url,
        sourceId: !!sourceId
      });
      return NextResponse.json(
        { error: 'Missing required fields: type, url, sourceId' },
        { status: 400 }
      );
    }

    if (type === 'crawl') {
      console.log(`[WEBHOOK:${requestId}] 📄 Processing crawl job for: ${url}`);
      
      // Get initial embedding queue stats
      const embeddingQueue = getEmbeddingQueue();
      const initialQueueStats = await embeddingQueue.getQueueStats();
      console.log(`[WEBHOOK:${requestId}] 📊 Initial embedding queue stats:`, initialQueueStats);
      
      // Process the page (pass depth info if available)
      const processingStartTime = Date.now();
      const result = await processPage(url, sourceId, { 
        depth: body.depth ?? 0, 
        maxDepth: body.maxDepth ?? 3 
      });
      const processingDuration = Date.now() - processingStartTime;
      
      console.log(`[WEBHOOK:${requestId}] ✅ Page processing completed in ${processingDuration}ms`);
      console.log(`[WEBHOOK:${requestId}] 📋 Processing result:`, {
        status: result.status,
        url: result.url,
        chunks: result.chunks,
        extraction_method: result.extraction_method,
        extraction_confidence: result.extraction_confidence,
        duration_ms: result.duration_ms,
        links_discovered: result.links_discovered,
        links_enqueued: result.links_enqueued,
        images_processed: result.images_processed,
        tables_processed: result.tables_processed
      });
      
      // Get final embedding queue stats to see what was added
      const finalQueueStats = await embeddingQueue.getQueueStats();
      const queueDelta = {
        pending: finalQueueStats.pending - initialQueueStats.pending,
        total: finalQueueStats.total - initialQueueStats.total
      };
      
      console.log(`[WEBHOOK:${requestId}] 📊 Final embedding queue stats:`, finalQueueStats);
      console.log(`[WEBHOOK:${requestId}] 📈 Queue changes:`, queueDelta);
      
      if (queueDelta.pending > 0) {
        console.log(`[WEBHOOK:${requestId}] 🔄 Added ${queueDelta.pending} new embedding jobs to queue`);
        
        // Log embedding queue details for this document
        if (result.status === 'success') {
          console.log(`[WEBHOOK:${requestId}] 🎯 Embedding jobs created for processed document`);
          console.log(`[WEBHOOK:${requestId}] 📝 Jobs will process ${result.chunks} chunks`);
          console.log(`[WEBHOOK:${requestId}] ⏰ Jobs scheduled for background processing via cron`);
        }
      } else {
        console.log(`[WEBHOOK:${requestId}] ℹ️ No new embedding jobs created (possibly duplicate content or error)`);
      }
      
      const totalDuration = Date.now() - startTime;
      console.log(`[WEBHOOK:${requestId}] 🏁 Webhook completed successfully in ${totalDuration}ms`);
      
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
        performance: {
          totalDuration,
          processingDuration,
          requestId
        },
        timestamp: new Date().toISOString()
      });
    }

    console.error(`[WEBHOOK:${requestId}] ❌ Unknown job type: ${type}`);
    return NextResponse.json(
      { error: 'Unknown job type' },
      { status: 400 }
    );

  } catch (error: any) {
    const totalDuration = Date.now() - startTime;
    console.error(`[WEBHOOK:${requestId}] 💥 Processing error after ${totalDuration}ms:`, {
      error: error.message,
      stack: error.stack,
      name: error.name,
      cause: error.cause
    });
    
    // Log additional context for debugging
    console.error(`[WEBHOOK:${requestId}] 🔍 Error context:`, {
      requestId,
      timestamp: new Date().toISOString(),
      duration: totalDuration,
      errorType: error.constructor.name
    });
    
    // Return 500 to trigger QStash retry
    const message = error instanceof Error ? error.message : 'Unexpected error';
    return NextResponse.json(
      { 
        error: message, 
        requestId,
        duration: totalDuration,
        timestamp: new Date().toISOString() 
      },
      { status: 500 }
    );
  }
}

// Wrap with QStash signature verification
export const POST = verifySignatureAppRouter(handler);
