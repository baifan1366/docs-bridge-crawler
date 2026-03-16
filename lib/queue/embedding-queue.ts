/**
 * Async embedding processing queue
 * Handles background embedding generation for document chunks
 */

import { createClient } from '../supabase/server';
import { generateDualEmbeddings } from '../embeddings/generator';
import { CRAWLER_CONFIG } from '../crawler/config';

export interface EmbeddingJob {
  id: string;
  document_id: string;
  chunk_id: string;
  chunk_text: string;
  priority: 'high' | 'normal' | 'low';
  created_at: string;
  attempts: number;
  max_attempts: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error_message?: string;
  processed_at?: string;
}

export interface QueueStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  total: number;
}

/**
 * Embedding queue manager
 */
export class EmbeddingQueue {
  private supabase: any;
  private isProcessing: boolean = false;
  private processingInterval?: NodeJS.Timeout;

  constructor() {
    this.initializeQueue();
  }

  private async initializeQueue() {
    this.supabase = await createClient();
  }

  /**
   * Add chunks to embedding queue
   */
  async enqueueChunks(
    documentId: string,
    chunks: Array<{ id: string; chunk_text: string }>,
    priority: 'high' | 'normal' | 'low' = 'normal'
  ): Promise<void> {
    console.log(`[EMBEDDING-QUEUE] Enqueueing ${chunks.length} chunks for document ${documentId}`);

    const jobs: Partial<EmbeddingJob>[] = chunks.map(chunk => ({
      id: `${documentId}_${chunk.id}_${Date.now()}`,
      document_id: documentId,
      chunk_id: chunk.id,
      chunk_text: chunk.chunk_text,
      priority,
      created_at: new Date().toISOString(),
      attempts: 0,
      max_attempts: 3,
      status: 'pending' as const
    }));

    // Store jobs in database (using a simple table for now)
    const { error } = await this.supabase
      .from('embedding_queue')
      .insert(jobs);

    if (error) {
      console.error('[EMBEDDING-QUEUE] Failed to enqueue jobs:', error);
      throw error;
    }

    console.log(`[EMBEDDING-QUEUE] Successfully enqueued ${jobs.length} jobs`);
  }

  /**
   * Process pending embedding jobs
   */
  async processQueue(batchSize: number = CRAWLER_CONFIG.EMBEDDING_BATCH_SIZE): Promise<void> {
    if (this.isProcessing) {
      console.log('[EMBEDDING-QUEUE] Already processing, skipping...');
      return;
    }

    this.isProcessing = true;
    console.log(`[EMBEDDING-QUEUE] Starting queue processing with batch size ${batchSize}`);

    try {
      // Get pending jobs ordered by priority and creation time
      const { data: jobs, error } = await this.supabase
        .from('embedding_queue')
        .select('*')
        .eq('status', 'pending')
        .order('priority', { ascending: false }) // high priority first
        .order('created_at', { ascending: true })  // oldest first
        .limit(batchSize);

      if (error) throw error;

      if (!jobs || jobs.length === 0) {
        console.log('[EMBEDDING-QUEUE] No pending jobs found');
        return;
      }

      console.log(`[EMBEDDING-QUEUE] Processing ${jobs.length} jobs`);

      // Process jobs in parallel (but limited by batch size)
      const promises = jobs.map((job: EmbeddingJob) => this.processJob(job));
      await Promise.allSettled(promises);

      console.log('[EMBEDDING-QUEUE] Batch processing completed');

    } catch (error) {
      console.error('[EMBEDDING-QUEUE] Error processing queue:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Process a single embedding job
   */
  private async processJob(job: EmbeddingJob): Promise<void> {
    console.log(`[EMBEDDING-QUEUE] Processing job ${job.id} for chunk ${job.chunk_id}`);

    // Mark job as processing
    await this.updateJobStatus(job.id, 'processing');

    try {
      // Generate embeddings
      const { small, large } = await generateDualEmbeddings(job.chunk_text);

      // Update document chunk with embeddings
      const { error: updateError } = await this.supabase
        .from('document_chunks')
        .update({
          embedding_small: small,
          embedding_large: large,
          updated_at: new Date().toISOString()
        })
        .eq('id', job.chunk_id);

      if (updateError) throw updateError;

      // Mark job as completed
      await this.updateJobStatus(job.id, 'completed', undefined, new Date().toISOString());

      console.log(`[EMBEDDING-QUEUE] ✅ Completed job ${job.id}`);

    } catch (error) {
      console.error(`[EMBEDDING-QUEUE] ❌ Failed job ${job.id}:`, error);

      const attempts = job.attempts + 1;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      if (attempts >= job.max_attempts) {
        // Mark as failed
        await this.updateJobStatus(job.id, 'failed', errorMessage);
      } else {
        // Retry later
        await this.supabase
          .from('embedding_queue')
          .update({
            status: 'pending',
            attempts,
            error_message: errorMessage
          })
          .eq('id', job.id);
      }
    }
  }

  /**
   * Update job status
   */
  private async updateJobStatus(
    jobId: string,
    status: EmbeddingJob['status'],
    errorMessage?: string,
    processedAt?: string
  ): Promise<void> {
    const updateData: any = { status };
    
    if (errorMessage) updateData.error_message = errorMessage;
    if (processedAt) updateData.processed_at = processedAt;

    await this.supabase
      .from('embedding_queue')
      .update(updateData)
      .eq('id', jobId);
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(): Promise<QueueStats> {
    const { data, error } = await this.supabase
      .from('embedding_queue')
      .select('status')
      .not('status', 'eq', 'completed'); // Exclude old completed jobs

    if (error) throw error;

    const stats: QueueStats = {
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      total: 0
    };

    if (data) {
      data.forEach((job: any) => {
        stats[job.status as keyof QueueStats]++;
        stats.total++;
      });
    }

    return stats;
  }

  /**
   * Clean up old completed jobs
   */
  async cleanupCompletedJobs(olderThanDays: number = 7): Promise<void> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    const { error } = await this.supabase
      .from('embedding_queue')
      .delete()
      .eq('status', 'completed')
      .lt('processed_at', cutoffDate.toISOString());

    if (error) {
      console.error('[EMBEDDING-QUEUE] Failed to cleanup old jobs:', error);
    } else {
      console.log(`[EMBEDDING-QUEUE] Cleaned up completed jobs older than ${olderThanDays} days`);
    }
  }

  /**
   * Start automatic queue processing
   */
  startAutoProcessing(intervalMs: number = 30000): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
    }

    console.log(`[EMBEDDING-QUEUE] Starting auto-processing every ${intervalMs}ms`);
    
    this.processingInterval = setInterval(async () => {
      try {
        await this.processQueue();
      } catch (error) {
        console.error('[EMBEDDING-QUEUE] Auto-processing error:', error);
      }
    }, intervalMs);
  }

  /**
   * Stop automatic queue processing
   */
  stopAutoProcessing(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = undefined;
      console.log('[EMBEDDING-QUEUE] Stopped auto-processing');
    }
  }

  /**
   * Force process all pending jobs for a specific document
   */
  async processDocumentJobs(documentId: string): Promise<void> {
    console.log(`[EMBEDDING-QUEUE] Force processing jobs for document ${documentId}`);

    const { data: jobs, error } = await this.supabase
      .from('embedding_queue')
      .select('*')
      .eq('document_id', documentId)
      .eq('status', 'pending');

    if (error) throw error;

    if (jobs && jobs.length > 0) {
      const promises = jobs.map((job: EmbeddingJob) => this.processJob(job));
      await Promise.allSettled(promises);
      console.log(`[EMBEDDING-QUEUE] Completed processing ${jobs.length} jobs for document ${documentId}`);
    }
  }
}

// Singleton instance
let queueInstance: EmbeddingQueue | null = null;

/**
 * Get the global embedding queue instance
 */
export function getEmbeddingQueue(): EmbeddingQueue {
  if (!queueInstance) {
    queueInstance = new EmbeddingQueue();
  }
  return queueInstance;
}