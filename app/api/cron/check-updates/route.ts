/**
 * Cron job to check for updated pages via sitemap
 * Also supports sources without sitemap (uses link discovery)
 * Runs daily at 2 AM via Vercel Cron
 * Supports pagination to avoid 300s timeout
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getUpdatedUrls } from '@/lib/sitemap/parser';
import { enqueueCrawlWithFlowControl } from '@/lib/qstash/client';
import { scheduleSitemapCheck } from '@/lib/qstash/scheduler';

const MAX_URLS_PER_RUN = 50;

export async function GET(request: NextRequest) {
  const startTime = Date.now();
  
  // Verify Vercel Cron request
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    console.error('[CRON] Unauthorized access attempt');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Check for continuation params
  const searchParams = request.nextUrl.searchParams;
  const sourceId = searchParams.get('source_id');
  const processedCount = parseInt(searchParams.get('processed') || '0');

  console.log(`[CRON] Starting sitemap check... (source: ${sourceId || 'all'}, processed: ${processedCount})`);

  const supabase = await createClient();

  try {
    // If continuing a specific source, process it
    if (sourceId) {
      const { data: source, error: sourceError } = await supabase
        .from('crawler_sources')
        .select('*')
        .eq('id', sourceId)
        .single();

      if (sourceError) throw sourceError;
      if (!source) {
        return NextResponse.json({ error: 'Source not found' }, { status: 404 });
      }

      const domain = new URL(source.base_url).hostname;
      const urlsToUpdate = await getUpdatedUrls(source.sitemap_url, supabase, source.id);

      const urlsToEnqueue = urlsToUpdate.slice(processedCount, processedCount + MAX_URLS_PER_RUN);
      const hasMore = processedCount + MAX_URLS_PER_RUN < urlsToUpdate.length;

      if (urlsToEnqueue.length > 0) {
        console.log(`[CRON] Enqueueing ${urlsToEnqueue.length} URLs (batch ${processedCount / MAX_URLS_PER_RUN + 1})`);
        
        for (const url of urlsToEnqueue) {
          await enqueueCrawlWithFlowControl(url, source.id, domain);
        }

        // Schedule follow-up if more URLs to process
        if (hasMore) {
          await scheduleSitemapCheck(sourceId, processedCount + urlsToEnqueue.length);
        }
      }

      return NextResponse.json({
        message: 'Crawl jobs enqueued',
        source: source.name,
        urls_enqueued: urlsToEnqueue.length,
        urls_pending: urlsToUpdate.length - processedCount - urlsToEnqueue.length,
        has_more: hasMore,
        duration_ms: Date.now() - startTime,
        timestamp: new Date().toISOString()
      });
    }

    // Initial run - get active sources
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
      const domain = new URL(source.base_url).hostname;
      console.log(`[CRON] Checking ${source.name}...`);

      try {
        if (source.sitemap_url) {
          // Get updated URLs
          const urlsToUpdate = await getUpdatedUrls(source.sitemap_url, supabase, source.id);

          if (urlsToUpdate.length > 0) {
            const urlsToEnqueue = urlsToUpdate.slice(0, MAX_URLS_PER_RUN);
            const hasMore = urlsToUpdate.length > MAX_URLS_PER_RUN;

            console.log(`[CRON] Enqueueing ${urlsToEnqueue.length} URLs for ${source.name}`);

            for (const url of urlsToEnqueue) {
              await enqueueCrawlWithFlowControl(url, source.id, domain);
            }

            // Schedule follow-up if more URLs
            if (hasMore) {
              await scheduleSitemapCheck(source.id, urlsToEnqueue.length);
            }

            stats.push({
              source: source.name,
              type: 'sitemap',
              urls_enqueued: urlsToEnqueue.length,
              urls_pending: urlsToUpdate.length - urlsToEnqueue.length,
              has_more: hasMore
            });
          } else {
            stats.push({
              source: source.name,
              type: 'sitemap',
              urls_enqueued: 0,
              urls_pending: 0
            });
          }
        } else {
          // Sources without sitemap - trigger link discovery
          await enqueueCrawlWithFlowControl(source.base_url, source.id, domain, {
            depth: 0,
            maxDepth: 3
          });
          
          stats.push({
            source: source.name,
            type: 'link-discovery',
            urls_enqueued: 1,
            message: 'Base URL enqueued for recursive crawl'
          });
        }
      } catch (error) {
        console.error(`[CRON] Error processing ${source.name}:`, error);
        stats.push({
          source: source.name,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
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