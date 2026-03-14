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
  const MAX_RETRIES = 2;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 1) {
        const backoffDelay = attempt * 2000; // 2s, 4s
        console.log(`[FETCH] Retry ${attempt}/${MAX_RETRIES} for ${url} after ${backoffDelay}ms`);
        await delay(backoffDelay);
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 second timeout

      const response = await fetch(url, { 
        headers,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      console.log(`[FETCH] ${url} - Status: ${response.status}`);

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

      // Other status codes
      console.error(`[FETCH] ${url} - Unexpected status: ${response.status}`);
      lastError = new Error(`HTTP ${response.status}`);
      
      // Don't retry on 4xx errors (client errors)
      if (response.status >= 400 && response.status < 500) {
        return { 
          status: 'error',
          errorMessage: `HTTP ${response.status}`
        };
      }
      
      // Retry on 5xx errors
      continue;

    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const errorMsg = lastError.message;
      
      console.error(`[FETCH] ${url} - Attempt ${attempt}/${MAX_RETRIES} failed:`, errorMsg);
      
      // Don't retry on abort/timeout for now, just fail
      if (errorMsg.includes('aborted') || errorMsg.includes('timeout')) {
        return { 
          status: 'error',
          errorMessage: errorMsg
        };
      }
      
      // Retry on network errors
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
