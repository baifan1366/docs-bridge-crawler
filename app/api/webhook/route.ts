/**
 * QStash webhook endpoint
 * Receives and processes crawl jobs from QStash queue
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifySignatureAppRouter } from '@upstash/qstash/nextjs';
import { processPage } from '@/lib/crawler/processor';

export const maxDuration = 300; // 5 minutes

async function handler(req: NextRequest) {
  try {
    const body = await req.json();
    const { type, url, sourceId } = body;

    console.log(`[WEBHOOK] Received job: ${type} for ${url}`);

    if (!type || !url || !sourceId) {
      return NextResponse.json(
        { error: 'Missing required fields: type, url, sourceId' },
        { status: 400 }
      );
    }

    if (type === 'crawl') {
      const result = await processPage(url, sourceId);
      
      return NextResponse.json({
        success: true,
        message: `Processed ${url}`,
        result,
        timestamp: new Date().toISOString()
      });
    }

    return NextResponse.json(
      { error: 'Unknown job type' },
      { status: 400 }
    );

  } catch (error: any) {
    console.error('[WEBHOOK] Processing error:', error);
    
    // Return 500 to trigger QStash retry
    const message = error instanceof Error ? error.message : 'Unexpected error';
    return NextResponse.json(
      { error: message, timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }
}

// Wrap with QStash signature verification
export const POST = verifySignatureAppRouter(handler);
