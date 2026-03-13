/**
 * Cron job to check for updated pages via sitemap
 * Runs every hour via Vercel Cron
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getUpdatedUrls } from '@/lib/sitemap/parser';
import { enqueueCrawlWithFlowControl } from '@/lib/qstash/client';

export async function GET(request: NextRequest) {
  const startTime = Date.now();
  
  // Verify Vercel Cron request
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    console.error('[CRON] Unauthorized access attempt');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  console.log('[CRON] Starting sitemap check...');

  const supabase = await createClient();

  try {
    // Get active sources
    const { data: sources, error: sourcesError } = await supabase
      .from('crawler_sources')
      .select('*')
      .eq('is_active', true);

    if (sourcesError) throw sourcesError;

    if (!sources || sources.length === 0) {
      console.log('[CRON] No active sources found');
      return NextResponse.json({ message: 'No sources to crawl' });
    }

    console.log(`[CRON] Found ${sources.length} active sources`);

    const stats = [];

    for (const source of sources) {
      if (!source.sitemap_url) {
        console.log(`[CRON] Skipping ${source.name} - no sitemap URL`);
        continue;
      }

      console.log(`[CRON] Checking ${source.name}...`);

      // Get updated URLs from sitemap
      const urlsToUpdate = await getUpdatedUrls(
        source.sitemap_url,
        supabase,
        source.id
      );

      if (urlsToUpdate.length > 0) {
        console.log(`[CRON] Found ${urlsToUpdate.length} updated URLs for ${source.name}`);
        
        // Extract domain for flow control
        const domain = new URL(source.base_url).hostname;

        // Enqueue with flow control
        for (const url of urlsToUpdate) {
          await enqueueCrawlWithFlowControl(url, source.id, domain);
        }

        stats.push({
          source: source.name,
          urls_enqueued: urlsToUpdate.length
        });
      } else {
        console.log(`[CRON] No updates for ${source.name}`);
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[CRON] Completed in ${duration}ms`);

    return NextResponse.json({
      message: 'Crawl jobs enqueued',
      stats,
      duration_ms: duration,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    const duration = Date.now() - startTime;
    console.error('[CRON] Error:', error);
    
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
