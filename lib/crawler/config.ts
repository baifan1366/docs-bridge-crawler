/**
 * Crawler configuration and limits
 */

export const CRAWLER_CONFIG = {
  // Content size limits to prevent database timeouts
  MAX_CONTENT_SIZE: 500000, // 500KB limit for processed text content
  MAX_RAW_CONTENT_SIZE: 1000000, // 1MB limit for raw HTML content
  
  // Processing limits
  MAX_PROCESSING_TIME: 300000, // 5 minutes max processing time
  MAX_CHUNK_SIZE: 1000, // Maximum chunk size for embeddings
  
  // Retry configuration
  MAX_RETRIES: 3,
  RETRY_DELAY: 1000, // 1 second base delay
  
  // Database timeouts
  DB_TIMEOUT: 30000, // 30 seconds for database operations
  
  // Content quality thresholds
  MIN_CONTENT_LENGTH: 100, // Minimum content length to process
  MAX_TITLE_LENGTH: 500, // Maximum title length
  
  // Embedding configuration
  EMBEDDING_BATCH_SIZE: 5, // Process embeddings in batches
  EMBEDDING_TIMEOUT: 60000, // 1 minute timeout for embedding generation
};

/**
 * Get truncated content based on size limits
 */
export function getTruncatedContent(content: string, maxSize: number = CRAWLER_CONFIG.MAX_CONTENT_SIZE): string {
  if (content.length <= maxSize) {
    return content;
  }
  
  return content.substring(0, maxSize) + '... [Content truncated due to size]';
}

/**
 * Get truncated HTML based on size limits
 */
export function getTruncatedHtml(html: string, maxSize: number = CRAWLER_CONFIG.MAX_RAW_CONTENT_SIZE): string {
  if (html.length <= maxSize) {
    return html;
  }
  
  return html.substring(0, maxSize) + '... [HTML truncated due to size]';
}

/**
 * Check if content meets quality thresholds
 */
export function isContentValid(content: string, title: string): boolean {
  return (
    content.length >= CRAWLER_CONFIG.MIN_CONTENT_LENGTH &&
    title.length > 0 &&
    title.length <= CRAWLER_CONFIG.MAX_TITLE_LENGTH
  );
}

/**
 * Get processing metadata for large content
 */
export function getProcessingMetadata(originalText: string, originalHtml: string, truncatedText: string, truncatedHtml: string) {
  return {
    original_content_size: originalText.length,
    original_html_size: originalHtml.length,
    processed_content_size: truncatedText.length,
    processed_html_size: truncatedHtml.length,
    content_truncated: originalText.length > CRAWLER_CONFIG.MAX_CONTENT_SIZE,
    html_truncated: originalHtml.length > CRAWLER_CONFIG.MAX_RAW_CONTENT_SIZE,
    truncation_ratio: {
      content: originalText.length > 0 ? truncatedText.length / originalText.length : 1,
      html: originalHtml.length > 0 ? truncatedHtml.length / originalHtml.length : 1
    }
  };
}