/**
 * QStash client for job queue management
 */

import { Client } from '@upstash/qstash';

const qstash = new Client({
  token: process.env.QSTASH_TOKEN!
});

/**
 * Enqueue single crawl job
 */
export async function enqueueCrawlJob(
  url: string,
  sourceId: string,
  options?: { depth?: number; maxDepth?: number }
) {
  const maxDepth = options?.maxDepth ?? 3; // Default max depth: 3
  
  // Don't enqueue if we've reached max depth
  if (options?.depth !== undefined && options.depth >= maxDepth) {
    console.log(`[CRAWL] Skipping ${url} - max depth ${maxDepth} reached`);
    return null;
  }

  const result = await qstash.publishJSON({
    url: process.env.WORKER_WEBHOOK_URL!,
    body: {
      type: 'crawl',
      url,
      sourceId,
      depth: (options?.depth ?? 0) + 1, // Increment depth for child pages
      maxDepth,
      timestamp: new Date().toISOString()
    },
    retries: 3,
    delay: 0
  });

  console.log(`Enqueued job ${result.messageId} for ${url} (depth: ${(options?.depth ?? 0) + 1}/${maxDepth})`);
  return result;
}

/**
 * Batch enqueue crawl jobs
 */
export async function enqueueBatchCrawl(
  urls: string[],
  sourceId: string
) {
  const messages = urls.map(url => ({
    url: process.env.WORKER_WEBHOOK_URL!,
    body: {
      type: 'crawl',
      url,
      sourceId,
      timestamp: new Date().toISOString()
    },
    retries: 3
  }));

  const results = await qstash.batchJSON(messages);
  
  console.log(`Enqueued ${results.length} jobs`);
  return results;
}

/**
 * Enqueue with flow control (rate limiting per domain)
 */
export async function enqueueCrawlWithFlowControl(
  url: string,
  sourceId: string,
  domain: string,
  options?: { depth?: number; maxDepth?: number }
) {
  const maxDepth = options?.maxDepth ?? 3;
  
  if (options?.depth !== undefined && options.depth >= maxDepth) {
    console.log(`[CRAWL] Skipping ${url} - max depth ${maxDepth} reached`);
    return null;
  }

  const result = await qstash.publishJSON({
    url: process.env.WORKER_WEBHOOK_URL!,
    body: {
      type: 'crawl',
      url,
      sourceId,
      depth: (options?.depth ?? 0) + 1,
      maxDepth,
      timestamp: new Date().toISOString()
    },
    // @ts-ignore - flowControl is not in types yet
    flowControl: {
      key: domain,
      parallelism: 1,
      rate: 5,
      period: 60
    },
    retries: 2,
    delay: Math.floor(Math.random() * 10)
  });

  return result;
}
