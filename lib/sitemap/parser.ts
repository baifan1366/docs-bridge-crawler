/**
 * Sitemap parser with lastmod detection and expired path filtering
 */

import { parseStringPromise } from 'xml2js';

// Common patterns for expired/old content paths
const EXPIRED_PATH_PATTERNS = [
  /\/bajet-\d{4}-old\//,      // e.g., /bajet-2022-old/
  /\/old\//,                   // any /old/ path
  /\/archive\//,               // any /archive/ path
  /\/archived\//,              // any /archived/ path
  /\/deprecated\//,            // any /deprecated/ path
  /\/expired\//,               // any /expired/ path
  /\/v1\//,                    // old API version paths
  /\/v2\//,                    // older API version paths
  /-\d{4}$/,                   // ends with year like -2022
  /_old$/,                     // ends with _old
  /_archive$/,                 // ends with _archive
];

/**
 * Check if a URL matches any expired path pattern
 */
function isExpiredPath(url: string): boolean {
  return EXPIRED_PATH_PATTERNS.some(pattern => pattern.test(url));
}

/**
 * Filter out expired/old content URLs
 */
function filterExpiredUrls(urls: SitemapEntry[]): SitemapEntry[] {
  const before = urls.length;
  const filtered = urls.filter(entry => !isExpiredPath(entry.url));
  const after = filtered.length;
  
  if (before !== after) {
    console.log(`[SITEMAP] Filtered out ${before - after} expired URLs`);
    
    // Log some examples of filtered URLs for debugging
    const filteredExamples = urls
      .filter(entry => isExpiredPath(entry.url))
      .slice(0, 5)
      .map(entry => entry.url);
    
    if (filteredExamples.length > 0) {
      console.log(`[SITEMAP] Examples of filtered URLs:`, filteredExamples);
    }
  }
  
  return filtered;
}

export interface SitemapEntry {
  url: string;
  lastmod?: string;
  changefreq?: string;
  priority?: number;
}

export async function parseSitemap(sitemapUrl: string): Promise<SitemapEntry[]> {
  console.log(`[SITEMAP] Fetching sitemap from: ${sitemapUrl}`);
  const fetchStart = Date.now();
  
  const response = await fetch(sitemapUrl, {
    signal: AbortSignal.timeout(30000) // 30 second timeout
  });
  
  console.log(`[SITEMAP] Fetch completed in ${Date.now() - fetchStart}ms, status: ${response.status}`);
  
  const xml = await response.text();
  console.log(`[SITEMAP] XML size: ${xml.length} bytes`);
  
  const parseStart = Date.now();
  const parsed = await parseStringPromise(xml);
  console.log(`[SITEMAP] XML parsed in ${Date.now() - parseStart}ms`);

  const urls: SitemapEntry[] = [];

  if (parsed.urlset?.url) {
    // Standard sitemap with URLs
    for (const entry of parsed.urlset.url) {
      urls.push({
        url: entry.loc[0],
        lastmod: entry.lastmod?.[0],
        changefreq: entry.changefreq?.[0],
        priority: parseFloat(entry.priority?.[0] || '0.5')
      });
    }
    console.log(`[SITEMAP] Found ${urls.length} URLs in sitemap`);
  } else if (parsed.sitemapindex?.sitemap) {
    // Sitemap index - recursively fetch all child sitemaps
    const childSitemaps = parsed.sitemapindex.sitemap;
    console.log(`[SITEMAP] Found sitemap index with ${childSitemaps.length} child sitemaps`);
    
    for (let i = 0; i < childSitemaps.length; i++) {
      const child = childSitemaps[i];
      const childUrl = child.loc[0];
      console.log(`[SITEMAP] Fetching child sitemap ${i + 1}/${childSitemaps.length}: ${childUrl}`);
      
      try {
        const childUrls = await parseSitemap(childUrl);
        urls.push(...childUrls);
        console.log(`[SITEMAP] Added ${childUrls.length} URLs from child sitemap`);
      } catch (error) {
        console.error(`[SITEMAP] Error fetching child sitemap ${childUrl}:`, error);
      }
    }
    
    console.log(`[SITEMAP] Total URLs from all sitemaps: ${urls.length}`);
  } else {
    console.warn('[SITEMAP] No URLs found in sitemap');
  }

  // Filter out expired/old content URLs
  const filteredUrls = filterExpiredUrls(urls);
  
  return filteredUrls;
}

export async function getUpdatedUrls(
  sitemapUrl: string,
  supabase: any,
  sourceId: string
): Promise<string[]> {
  console.log(`[SITEMAP] Starting getUpdatedUrls for source: ${sourceId}`);
  const totalStart = Date.now();
  
  const entries = await parseSitemap(sitemapUrl);
  console.log(`[SITEMAP] Parsed ${entries.length} entries from sitemap`);
  
  if (entries.length === 0) {
    console.log('[SITEMAP] No entries found in sitemap');
    return [];
  }

  // Batch fetch existing pages to avoid N+1 queries
  const dbStart = Date.now();
  const urls = entries.map(e => e.url);
  console.log(`[SITEMAP] Fetching existing pages from DB for ${urls.length} URLs...`);
  
  // Split into batches to avoid query size limits (max 100 per batch)
  const BATCH_SIZE = 100;
  const batches = [];
  for (let i = 0; i < urls.length; i += BATCH_SIZE) {
    batches.push(urls.slice(i, i + BATCH_SIZE));
  }
  
  console.log(`[SITEMAP] Querying in ${batches.length} batches...`);
  
  let allExistingPages: any[] = [];
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    console.log(`[SITEMAP] Fetching batch ${i + 1}/${batches.length} (${batch.length} URLs)...`);
    
    const { data, error } = await supabase
      .from('crawler_pages')
      .select('url, sitemap_lastmod, crawl_status, last_crawled_at')
      .eq('source_id', sourceId)
      .in('url', batch);

    if (error) {
      console.error(`[SITEMAP] Error fetching batch ${i + 1}:`, error);
      throw error;
    }
    
    if (data) {
      allExistingPages = allExistingPages.concat(data);
    }
  }

  console.log(`[SITEMAP] DB query completed in ${Date.now() - dbStart}ms, found ${allExistingPages.length} existing pages`);

  // Create a map for quick lookup
  const existingMap = new Map<string, { lastmod: string | null, status: string, lastCrawled: string }>(
    allExistingPages.map((p: any) => [p.url, { 
      lastmod: p.sitemap_lastmod, 
      status: p.crawl_status,
      lastCrawled: p.last_crawled_at
    }])
  );

  const updatedUrls: string[] = [];
  let newPages = 0;
  let updatedPages = 0;
  let unchangedPages = 0;
  let skippedFailedPages = 0;

  // Skip pages that failed in the last 24 hours
  const RETRY_AFTER_HOURS = 24;
  const retryAfterMs = RETRY_AFTER_HOURS * 60 * 60 * 1000;

  for (const entry of entries) {
    const existing = existingMap.get(entry.url);

    if (!existing) {
      // New page
      updatedUrls.push(entry.url);
      newPages++;
    } else if (existing.status === 'failed') {
      // Check if we should retry failed pages
      const lastCrawledTime = new Date(existing.lastCrawled).getTime();
      const now = Date.now();
      
      if (now - lastCrawledTime < retryAfterMs) {
        // Skip recently failed pages
        skippedFailedPages++;
        continue;
      } else {
        // Retry after cooldown period
        updatedUrls.push(entry.url);
        updatedPages++;
      }
    } else if (entry.lastmod && existing.lastmod) {
      // Compare lastmod dates
      const sitemapDate = new Date(entry.lastmod);
      const existingDate = new Date(existing.lastmod);
      
      if (sitemapDate > existingDate) {
        updatedUrls.push(entry.url);
        updatedPages++;
      } else {
        unchangedPages++;
      }
    } else {
      // No lastmod in sitemap, need to check with If-Modified-Since
      updatedUrls.push(entry.url);
      updatedPages++;
    }
  }

  const totalTime = Date.now() - totalStart;
  console.log(`[SITEMAP] Analysis complete in ${totalTime}ms:`);
  console.log(`[SITEMAP]   - New pages: ${newPages}`);
  console.log(`[SITEMAP]   - Updated pages: ${updatedPages}`);
  console.log(`[SITEMAP]   - Unchanged pages: ${unchangedPages}`);
  console.log(`[SITEMAP]   - Skipped failed pages (retry after ${RETRY_AFTER_HOURS}h): ${skippedFailedPages}`);
  console.log(`[SITEMAP]   - Total to crawl: ${updatedUrls.length}`);

  return updatedUrls;
}
