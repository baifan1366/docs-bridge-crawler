/**
 * Smart HTTP fetcher with If-Modified-Since and ETag support
 */

export interface FetchResult {
  html?: string;
  status: 'modified' | 'not-modified' | 'error';
  etag?: string;
  lastModified?: string;
  errorMessage?: string;
}

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function smartFetch(
  url: string,
  existingPage?: {
    etag?: string;
    last_modified_header?: string;
  }
): Promise<FetchResult> {
  // Add random delay before fetching (1-3 seconds) to appear more human-like
  const randomDelay = 1000 + Math.floor(Math.random() * 2000);
  console.log(`[FETCH] Waiting ${randomDelay}ms before fetching ${url}`);
  await delay(randomDelay);

  const headers: Record<string, string> = {
    'User-Agent': getRandomUserAgent(),
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9,ms;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Cache-Control': 'max-age=0'
  };

  // Add conditional headers
  if (existingPage?.etag) {
    headers['If-None-Match'] = existingPage.etag;
  }
  if (existingPage?.last_modified_header) {
    headers['If-Modified-Since'] = existingPage.last_modified_header;
  }

  // Retry logic
  const MAX_RETRIES = 3; // Increased from 2 to 3
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 1) {
        // Exponential backoff with jitter: 5s, 10s, 20s
        const baseDelay = attempt * 5000;
        const jitter = Math.floor(Math.random() * 2000);
        const backoffDelay = baseDelay + jitter;
        console.log(`[FETCH] Retry ${attempt}/${MAX_RETRIES} for ${url} after ${backoffDelay}ms`);
        await delay(backoffDelay);
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 90000); // Increased to 90 seconds

      const response = await fetch(url, { 
        headers,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      console.log(`[FETCH] ${url} - Status: ${response.status} (Attempt ${attempt}/${MAX_RETRIES})`);

      // 304 Not Modified
      if (response.status === 304) {
        return { status: 'not-modified' };
      }

      // 200 OK
      if (response.status === 200) {
        const html = await response.text();
        console.log(`[FETCH] ${url} - Downloaded ${html.length} bytes`);
        return {
          html,
          status: 'modified',
          etag: response.headers.get('etag') || undefined,
          lastModified: response.headers.get('last-modified') || undefined
        };
      }

      // 429 Too Many Requests - wait longer
      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after');
        const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : 30000;
        console.log(`[FETCH] ${url} - Rate limited, waiting ${waitTime}ms`);
        if (attempt < MAX_RETRIES) {
          await delay(waitTime);
          continue;
        }
      }

      // 5xx Server errors - retry with longer backoff
      if (response.status >= 500) {
        console.error(`[FETCH] ${url} - Server error: ${response.status}`);
        lastError = new Error(`HTTP ${response.status}`);
        if (attempt < MAX_RETRIES) {
          continue;
        }
      }

      // 4xx Client errors - don't retry
      if (response.status >= 400 && response.status < 500) {
        console.error(`[FETCH] ${url} - Client error: ${response.status}`);
        return { 
          status: 'error',
          errorMessage: `HTTP ${response.status}`
        };
      }

      // Other unexpected status codes
      console.error(`[FETCH] ${url} - Unexpected status: ${response.status}`);
      lastError = new Error(`HTTP ${response.status}`);
      
      if (attempt < MAX_RETRIES) {
        continue;
      }

    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const errorMsg = lastError.message;
      
      console.error(`[FETCH] ${url} - Attempt ${attempt}/${MAX_RETRIES} failed:`, errorMsg);
      
      // For timeout/abort, retry with longer timeout
      if ((errorMsg.includes('aborted') || errorMsg.includes('timeout')) && attempt < MAX_RETRIES) {
        console.log(`[FETCH] ${url} - Timeout, will retry with longer timeout`);
        continue;
      }
      
      // For network errors, retry
      if (attempt < MAX_RETRIES) {
        continue;
      }
    }
  }

  return { 
    status: 'error',
    errorMessage: lastError?.message || 'Unknown error'
  };
}
