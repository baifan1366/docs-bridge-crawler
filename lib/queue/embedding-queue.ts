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

export class EmbeddingQueue {
  private supabase: any;
  private isProcessing: boolean = false;
  private processingInterval?: NodeJS.Timeout;
  private initPromise: Promise<void>;

  constructor() {
    this.initPromise = this.initializeQueue();
  }

  private async initializeQueue() {
    this.supabase = await createClient();
  }

  private async ensureInitialized() {
    await this.initPromise;
  }

  async enqueueChunks(
    documentId: string,
    chunks: Array<{ id: string; chunk_text: string }>,
    priority: 'high' | 'normal' | 'low' = 'normal'
  ): Promise<void> {
    await this.ensureInitialized();

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

    const { error } = await this.supabase.from('embedding_queue').insert(jobs);

    if (error) {
      console.error('[EMBEDDING-QUEUE] Failed to enqueue jobs:', error);
      throw error;
    }
  }

  async processQueue(batchSize: number = CRAWLER_CONFIG.EMBEDDING_BATCH_SIZE): Promise<void> {
    await this.ensureInitialized();
    
    if (this.isProcessing) return;

    this.isProcessing = true;

    try {
      const { data: jobs, error } = await this.supabase
        .from('embedding_queue')
        .select('*')
        .eq('status', 'pending')
        .order('priority', { ascending: false })
        .order('created_at', { ascending: true })
        .limit(batchSize);

      if (error) throw error;

      if (!jobs || jobs.length === 0) return;

      const promises = jobs.map((job: EmbeddingJob) => this.processJob(job));
      await Promise.allSettled(promises);

    } catch (error) {
      console.error('[EMBEDDING-QUEUE] Error processing queue:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  private async processJob(job: EmbeddingJob): Promise<void> {
    await this.updateJobStatus(job.id, 'processing');

    try {
      const { small, large } = await generateDualEmbeddings(job.chunk_text);

      const { error: updateError } = await this.supabase
        .from('document_chunks')
        .update({
          embedding_small: small,
          embedding_large: large,
          updated_at: new Date().toISOString()
        })
        .eq('id', job.chunk_id);

      if (updateError) {
        console.error('[EMBEDDING-QUEUE] Failed to save embeddings:', updateError);
        throw updateError;
      }

      await this.updateJobStatus(job.id, 'completed', undefined, new Date().toISOString());

    } catch (error) {
      const attempts = job.attempts + 1;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      if (attempts >= job.max_attempts) {
        await this.updateJobStatus(job.id, 'failed', errorMessage);
      } else {
        await this.supabase.from('embedding_queue').update({
          status: 'pending',
          attempts,
          error_message: errorMessage
        }).eq('id', job.id);
      }
    }
  }

  private async updateJobStatus(
    jobId: string,
    status: EmbeddingJob['status'],
    errorMessage?: string,
    processedAt?: string
  ): Promise<void> {
    const updateData: any = { status };
    if (errorMessage) updateData.error_message = errorMessage;
    if (processedAt) updateData.processed_at = processedAt;

    await this.supabase.from('embedding_queue').update(updateData).eq('id', jobId);
  }

  async getQueueStats(): Promise<QueueStats> {
    await this.ensureInitialized();
    
    const { data, error } = await this.supabase
      .from('embedding_queue')
      .select('status')
      .not('status', 'eq', 'completed');

    if (error) throw error;

    const stats: QueueStats = { pending: 0, processing: 0, completed: 0, failed: 0, total: 0 };

    if (data) {
      data.forEach((job: any) => {
        stats[job.status as keyof QueueStats]++;
        stats.total++;
      });
    }

    return stats;
  }

  async cleanupCompletedJobs(olderThanDays: number = 7): Promise<void> {
    await this.ensureInitialized();
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    const { error } = await this.supabase
      .from('embedding_queue')
      .delete()
      .eq('status', 'completed')
      .lt('processed_at', cutoffDate.toISOString());

    if (error) {
      console.error('[EMBEDDING-QUEUE] Failed to cleanup old jobs:', error);
    }
  }

  startAutoProcessing(intervalMs: number = 30000): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
    }

    this.processingInterval = setInterval(async () => {
      try {
        await this.processQueue();
      } catch (error) {
        console.error('[EMBEDDING-QUEUE] Auto-processing error:', error);
      }
    }, intervalMs);
  }

  stopAutoProcessing(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = undefined;
    }
  }

  async processDocumentJobs(documentId: string): Promise<void> {
    await this.ensureInitialized();
    
    const { data: jobs, error } = await this.supabase
      .from('embedding_queue')
      .select('*')
      .eq('document_id', documentId)
      .eq('status', 'pending');

    if (error) throw error;

    if (jobs && jobs.length > 0) {
      const promises = jobs.map((job: EmbeddingJob) => this.processJob(job));
      await Promise.allSettled(promises);
    }
  }
}

let queueInstance: EmbeddingQueue | null = null;

export function getEmbeddingQueue(): EmbeddingQueue {
  if (!queueInstance) {
    queueInstance = new EmbeddingQueue();
  }
  return queueInstance;
}