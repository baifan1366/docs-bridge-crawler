/**
 * Cron job to check for updated pages via sitemap
 * Also supports sources without sitemap (uses link discovery)
 * Runs daily at 2 AM via Vercel Cron
 * Note: Hobby accounts are limited to daily cron jobs with ±59 min precision
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
      const domain = new URL(source.base_url).hostname;
      console.log(`[CRON] Checking ${source.name}...`);
      const sourceStart = Date.now();

      try {
        if (source.sitemap_url) {
          // === Sources WITH sitemap ===
          console.log(`[CRON] ${source.name} has sitemap, checking for updates...`);
          
          const urlsToUpdate = await getUpdatedUrls(
            source.sitemap_url,
            supabase,
            source.id
          );

          console.log(`[CRON] Source check completed in ${Date.now() - sourceStart}ms`);

          if (urlsToUpdate.length > 0) {
            console.log(`[CRON] Found ${urlsToUpdate.length} updated URLs for ${source.name}`);
            
            const MAX_URLS_PER_RUN = 50;
            const urlsToEnqueue = urlsToUpdate.slice(0, MAX_URLS_PER_RUN);
            
            if (urlsToUpdate.length > MAX_URLS_PER_RUN) {
              console.log(`[CRON] Limiting to ${MAX_URLS_PER_RUN} URLs`);
            }
            
            console.log(`[CRON] Enqueueing ${urlsToEnqueue.length} URLs...`);
            const enqueueStart = Date.now();
            
            for (const url of urlsToEnqueue) {
              await enqueueCrawlWithFlowControl(url, source.id, domain);
            }
            
            console.log(`[CRON] Enqueue completed in ${Date.now() - enqueueStart}ms`);

            stats.push({
              source: source.name,
              type: 'sitemap',
              urls_enqueued: urlsToEnqueue.length,
              urls_pending: urlsToUpdate.length - urlsToEnqueue.length
            });
          } else {
            console.log(`[CRON] No updates for ${source.name}`);
            stats.push({
              source: source.name,
              type: 'sitemap',
              urls_enqueued: 0,
              urls_pending: 0
            });
          }
        } else {
          // === Sources WITHOUT sitemap (use link discovery) ===
          console.log(`[CRON] ${source.name} has no sitemap, triggering full crawl from base_url...`);
          
          // Enqueue the base_url to start link discovery crawl
          await enqueueCrawlWithFlowControl(source.base_url, source.id, domain, {
            depth: 0,
            maxDepth: 3
          });
          
          console.log(`[CRON] Enqueued base URL for link discovery crawl`);
          
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
