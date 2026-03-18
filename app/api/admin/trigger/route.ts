/**
 * Manual trigger API for testing
 * Allows manually triggering a crawl for a specific URL
 */

import { NextRequest, NextResponse } from 'next/server';
import { enqueueCrawlJob } from '@/lib/qstash/client';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { url, sourceId } = body;

    if (!url || !sourceId) {
      return NextResponse.json(
        { error: 'url and sourceId are required' },
        { status: 400 }
      );
    }

    const result = await enqueueCrawlJob(url, sourceId);

    if (!result) {
      return NextResponse.json(
        { error: 'Could not enqueue crawl job (may have reached max depth)' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      message: 'Crawl job enqueued',
      messageId: result.messageId,
      url,
      sourceId
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
