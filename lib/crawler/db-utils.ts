/**
 * Database utilities for crawler with retry logic and timeout handling
 */

import { CRAWLER_CONFIG } from './config';

export interface RetryOptions {
  maxRetries?: number;
  baseDelay?: number;
  maxDelay?: number;
  backoffFactor?: number;
}

/**
 * Execute database operation with retry logic
 */
export async function executeWithRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = CRAWLER_CONFIG.MAX_RETRIES,
    baseDelay = CRAWLER_CONFIG.RETRY_DELAY,
    maxDelay = 30000,
    backoffFactor = 2
  } = options;

  let lastError: Error;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;
      
      // Don't retry on certain types of errors
      if (isNonRetryableError(error)) {
        throw error;
      }
      
      if (attempt === maxRetries) {
        console.error(`[DB-RETRY] Final attempt failed:`, error);
        throw error;
      }
      
      const delay = Math.min(baseDelay * Math.pow(backoffFactor, attempt - 1), maxDelay);
      console.warn(`[DB-RETRY] Attempt ${attempt}/${maxRetries} failed, retrying in ${delay}ms:`, error);
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError!;
}

/**
 * Check if error should not be retried
 */
function isNonRetryableError(error: any): boolean {
  if (!error) return false;
  
  const message = error.message?.toLowerCase() || '';
  const code = error.code || '';
  
  // Don't retry on validation errors, permission errors, etc.
  const nonRetryableCodes = ['23505', '42501', '42P01']; // Unique violation, permission denied, undefined table
  const nonRetryableMessages = [
    'permission denied',
    'does not exist',
    'already exists',
    'invalid input',
    'constraint violation'
  ];
  
  return (
    nonRetryableCodes.includes(code) ||
    nonRetryableMessages.some(msg => message.includes(msg))
  );
}

/**
 * Execute database operation with timeout
 */
export async function executeWithTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number = CRAWLER_CONFIG.DB_TIMEOUT
): Promise<T> {
  return Promise.race([
    operation(),
    new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Database operation timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    })
  ]);
}

/**
 * Execute database operation with both retry and timeout
 */
export async function executeWithRetryAndTimeout<T>(
  operation: () => Promise<T>,
  retryOptions: RetryOptions = {},
  timeoutMs: number = CRAWLER_CONFIG.DB_TIMEOUT
): Promise<T> {
  return executeWithRetry(
    () => executeWithTimeout(operation, timeoutMs),
    retryOptions
  );
}

/**
 * Batch insert with size limits and retry logic
 */
export async function batchInsert<T>(
  supabase: any,
  tableName: string,
  records: T[],
  batchSize: number = 100
): Promise<void> {
  console.log(`[DB-BATCH] Inserting ${records.length} records into ${tableName} in batches of ${batchSize}`);
  
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    
    await executeWithRetryAndTimeout(async () => {
      const { error } = await supabase
        .from(tableName)
        .insert(batch);
      
      if (error) {
        throw error;
      }
      
      console.log(`[DB-BATCH] Inserted batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(records.length / batchSize)}`);
    });
  }
  
  console.log(`[DB-BATCH] Completed inserting ${records.length} records`);
}

/**
 * Safe document insert/update with size validation
 */
export async function safeDocumentUpsert(
  supabase: any,
  documentData: any,
  existingDocId?: string
): Promise<any> {
  // Validate document size
  const contentSize = documentData.content?.length || 0;
  const htmlSize = documentData.raw_content?.length || 0;
  
  if (contentSize > CRAWLER_CONFIG.MAX_CONTENT_SIZE * 2) {
    throw new Error(`Content too large: ${contentSize} bytes (max: ${CRAWLER_CONFIG.MAX_CONTENT_SIZE * 2})`);
  }
  
  if (htmlSize > CRAWLER_CONFIG.MAX_RAW_CONTENT_SIZE * 2) {
    throw new Error(`HTML too large: ${htmlSize} bytes (max: ${CRAWLER_CONFIG.MAX_RAW_CONTENT_SIZE * 2})`);
  }
  
  return executeWithRetryAndTimeout(async () => {
    if (existingDocId) {
      // Update existing document
      const { data, error } = await supabase
        .from('kb_documents')
        .update(documentData)
        .eq('id', existingDocId)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    } else {
      // Insert new document
      const { data, error } = await supabase
        .from('kb_documents')
        .insert(documentData)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    }
  });
}