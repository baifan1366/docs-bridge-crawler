/**
 * Sitemap parser with lastmod detection
 */

import { parseStringPromise } from 'xml2js';

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
    console.log(`[SITEMAP] Found sitemap index with ${parsed.sitemapindex.sitemap.length} sitemaps`);
    // Handle sitemap index - just log for now
    console.warn('[SITEMAP] Sitemap index detected but not fully supported yet');
  } else {
    console.warn('[SITEMAP] No URLs found in sitemap');
  }

  return urls;
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
      .select('url, sitemap_lastmod')
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
  const existingMap = new Map<string, string | null>(
    allExistingPages.map((p: any) => [p.url, p.sitemap_lastmod])
  );

  const updatedUrls: string[] = [];
  let newPages = 0;
  let updatedPages = 0;
  let unchangedPages = 0;

  for (const entry of entries) {
    const existingLastmod = existingMap.get(entry.url);

    if (existingLastmod === undefined) {
      // New page
      updatedUrls.push(entry.url);
      newPages++;
    } else if (entry.lastmod && existingLastmod) {
      // Compare lastmod dates
      const sitemapDate = new Date(entry.lastmod);
      const existingDate = new Date(existingLastmod);
      
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
  console.log(`[SITEMAP]   - Total to crawl: ${updatedUrls.length}`);

  return updatedUrls;
}
