/**
 * Embedding queue management API
 * GET - Get queue statistics
 * POST - Process queue manually
 */

import { NextRequest, NextResponse } from 'next/server';
import { getEmbeddingQueue } from '@/lib/queue/embedding-queue';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');

    const embeddingQueue = getEmbeddingQueue();

    switch (action) {
      case 'stats':
        const stats = await embeddingQueue.getQueueStats();
        return NextResponse.json({
          success: true,
          stats,
          timestamp: new Date().toISOString()
        });

      case 'cleanup':
        const days = parseInt(searchParams.get('days') || '7');
        await embeddingQueue.cleanupCompletedJobs(days);
        return NextResponse.json({
          success: true,
          message: `Cleaned up completed jobs older than ${days} days`,
          timestamp: new Date().toISOString()
        });

      default:
        const queueStats = await embeddingQueue.getQueueStats();
        return NextResponse.json({
          success: true,
          queue: queueStats,
          actions: {
            stats: '/api/queue/embeddings?action=stats',
            cleanup: '/api/queue/embeddings?action=cleanup&days=7',
            process: 'POST /api/queue/embeddings'
          },
          timestamp: new Date().toISOString()
        });
    }

  } catch (error: any) {
    console.error('[QUEUE-API] Error:', error);
    
    return NextResponse.json(
      { 
        success: false,
        error: error instanceof Error ? error.message : 'Unexpected error',
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    const { searchParams } = new URL(request.url);
    const batchSize = parseInt(searchParams.get('batch_size') || '5');
    const documentId = searchParams.get('document_id');

    const embeddingQueue = getEmbeddingQueue();

    if (documentId) {
      // Process jobs for specific document
      console.log(`[QUEUE-API] Processing jobs for document: ${documentId}`);
      await embeddingQueue.processDocumentJobs(documentId);
      
      return NextResponse.json({
        success: true,
        message: `Processed all jobs for document ${documentId}`,
        duration_ms: Date.now() - startTime,
        timestamp: new Date().toISOString()
      });
    } else {
      // Process queue with batch size
      console.log(`[QUEUE-API] Processing queue with batch size: ${batchSize}`);
      await embeddingQueue.processQueue(batchSize);
      
      const stats = await embeddingQueue.getQueueStats();
      
      return NextResponse.json({
        success: true,
        message: `Processed queue batch of ${batchSize}`,
        stats,
        duration_ms: Date.now() - startTime,
        timestamp: new Date().toISOString()
      });
    }

  } catch (error: any) {
    const duration = Date.now() - startTime;
    console.error('[QUEUE-API] Error:', error);
    
    return NextResponse.json(
      { 
        success: false,
        error: error instanceof Error ? error.message : 'Unexpected error',
        duration_ms: duration,
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
}