/**
 * QStash scheduler for cron job follow-ups
 * Enables splitting large workloads across multiple requests
 */

import { Client } from '@upstash/qstash';

const qstash = new Client({
  token: process.env.QSTASH_TOKEN!
});

/**
 * Schedule a cron job to run again (for pagination/continuation)
 */
export async function scheduleFollowUp(
  cronPath: string,
  delaySeconds: number = 60,
  additionalParams?: Record<string, string>
) {
  const baseUrl = process.env.VERCEL_URL 
    ? `https://${process.env.VERCEL_URL}`
    : process.env.NEXT_PUBLIC_SITE_URL || 'https://your-domain.com';
  
  const url = new URL(`${baseUrl}${cronPath}`);
  
  if (additionalParams) {
    Object.entries(additionalParams).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });
  }

  console.log(`[SCHEDULER] Scheduling follow-up for ${url.toString()} in ${delaySeconds}s`);

  await qstash.publishJSON({
    url: url.toString(),
    body: {},
    retries: 0,
    delay: delaySeconds
  });

  return true;
}

/**
 * Schedule embedding check continuation
 */
export async function scheduleEmbeddingCheck(offset: number) {
  return scheduleFollowUp('/api/cron/check-embeddings', 30, { offset: offset.toString() });
}

/**
 * Schedule sitemap check continuation
 */
export async function scheduleSitemapCheck(sourceId: string, processedCount: number) {
  return scheduleFollowUp('/api/cron/check-updates', 30, { 
    source_id: sourceId,
    processed: processedCount.toString() 
  });
}