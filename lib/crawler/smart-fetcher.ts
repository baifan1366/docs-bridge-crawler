/**
 * Smart HTTP fetcher with If-Modified-Since and ETag support
 */

export interface FetchResult {
  html?: string;
  status: 'modified' | 'not-modified' | 'error';
  etag?: string;
  lastModified?: string;
}

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'
];

function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
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
  };

  // Add conditional headers
  if (existingPage?.etag) {
    headers['If-None-Match'] = existingPage.etag;
  }
  if (existingPage?.last_modified_header) {
    headers['If-Modified-Since'] = existingPage.last_modified_header;
  }

  try {
    const response = await fetch(url, { headers });

    // 304 Not Modified
    if (response.status === 304) {
      return { status: 'not-modified' };
    }

    // 200 OK
    if (response.status === 200) {
      const html = await response.text();
      return {
        html,
        status: 'modified',
        etag: response.headers.get('etag') || undefined,
        lastModified: response.headers.get('last-modified') || undefined
      };
    }

    return { status: 'error' };
  } catch (error) {
    console.error(`Fetch error for ${url}:`, error);
    return { status: 'error' };
  }
}
