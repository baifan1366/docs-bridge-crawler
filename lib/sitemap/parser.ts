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
  const response = await fetch(sitemapUrl);
  const xml = await response.text();
  const parsed = await parseStringPromise(xml);

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
  }

  return urls;
}

export async function getUpdatedUrls(
  sitemapUrl: string,
  supabase: any,
  sourceId: string
): Promise<string[]> {
  const entries = await parseSitemap(sitemapUrl);
  const updatedUrls: string[] = [];

  for (const entry of entries) {
    // Check if page exists and compare lastmod
    const { data: existingPage } = await supabase
      .from('crawler_pages')
      .select('sitemap_lastmod')
      .eq('url', entry.url)
      .eq('source_id', sourceId)
      .single();

    if (!existingPage) {
      // New page
      updatedUrls.push(entry.url);
    } else if (entry.lastmod && existingPage.sitemap_lastmod) {
      // Compare lastmod dates
      const sitemapDate = new Date(entry.lastmod);
      const existingDate = new Date(existingPage.sitemap_lastmod);
      
      if (sitemapDate > existingDate) {
        updatedUrls.push(entry.url);
      }
    } else {
      // No lastmod, need to check with If-Modified-Since
      updatedUrls.push(entry.url);
    }
  }

  return updatedUrls;
}
