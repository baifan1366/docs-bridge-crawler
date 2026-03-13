/**
 * Admin API to view crawler statistics
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCrawlerStats } from '@/lib/monitoring/metrics';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const hours = parseInt(searchParams.get('hours') || '24');

    const stats = await getCrawlerStats(hours);

    return NextResponse.json({ stats });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
