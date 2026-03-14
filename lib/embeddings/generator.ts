/**
 * Embedding generation for crawler service
 * Uses @huggingface/transformers with singleton pattern for Next.js
 * 
 * IMPORTANT: No external API calls - runs entirely locally using WASM backend
 */

import { pipeline, env } from '@huggingface/transformers';

const MODEL = 'Xenova/bge-small-en-v1.5'; // 384-dim
const EMBEDDING_DIM = 384;

// Configure environment on module load
env.allowLocalModels = false;
env.allowRemoteModels = true;
env.useBrowserCache = false;
env.cacheDir = '/tmp/.transformers-cache';

// Force WASM backend
if (env.backends?.onnx?.wasm) {
  env.backends.onnx.wasm.proxy = false;
  env.backends.onnx.wasm.numThreads = 1;
}

console.log('[Crawler Embeddings] Environment configured');

/**
 * Singleton pattern for pipeline instance
 * This is critical for Next.js serverless functions
 */
class EmbeddingPipeline {
  static model = MODEL;
  static instance: any = null;
  static isInitializing = false;

  static async getInstance() {
    // Wait if initialization is in progress
    while (this.isInitializing) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    if (this.instance === null) {
      try {
        this.isInitializing = true;
        console.log(`[Crawler Embeddings] Initializing ${this.model} with WASM backend...`);
        
        this.instance = await pipeline('feature-extraction', this.model, {
          dtype: 'q8', // Quantized for WASM
        });
        
        console.log(`[Crawler Embeddings] ✅ Model ready`);
      } catch (error) {
        console.error('[Crawler Embeddings] Failed to initialize:', error);
        this.instance = null;
        throw error;
      } finally {
        this.isInitializing = false;
      }
    }

    return this.instance;
  }
}

// Use global singleton in development to avoid reinitialization
let PipelineSingleton: typeof EmbeddingPipeline;
if (process.env.NODE_ENV !== 'production') {
  if (!(global as any).EmbeddingPipeline) {
    (global as any).EmbeddingPipeline = EmbeddingPipeline;
  }
  PipelineSingleton = (global as any).EmbeddingPipeline;
} else {
  PipelineSingleton = EmbeddingPipeline;
}

console.log('[Crawler Embeddings] Singleton configured');

/**
 * Generate 384-dim embedding for document chunks
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  try {
    console.log(`[Crawler Embeddings] Generating embedding for: "${text.substring(0, 50)}..."`);
    
    // Get singleton instance
    const extractor = await PipelineSingleton.getInstance();
    
    // Add "passage:" prefix for document embeddings (BGE model requirement)
    const prefixedText = `passage: ${text}`;
    
    const output = await extractor(prefixedText, {
      pooling: 'mean',
      normalize: true,
    });
    
    const embedding = Array.from(output.data) as number[];
    
    if (embedding.length !== EMBEDDING_DIM) {
      throw new Error(`Expected ${EMBEDDING_DIM}-dim embedding, got ${embedding.length}-dim`);
    }
    
    console.log(`[Crawler Embeddings] ✅ Generated ${embedding.length}-dim embedding`);
    return embedding;
  } catch (error) {
    console.error('[Crawler Embeddings] Error:', error);
    throw new Error(`Failed to generate embedding: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Batch generate embeddings
 */
export async function generateEmbeddingsBatch(texts: string[]): Promise<number[][]> {
  try {
    console.log(`[Crawler Embeddings] Generating batch embeddings for ${texts.length} texts...`);
    
    const embeddings = await Promise.all(
      texts.map(text => generateEmbedding(text))
    );
    
    console.log(`[Crawler Embeddings] ✅ Batch completed: ${embeddings.length} embeddings`);
    return embeddings;
  } catch (error) {
    console.error('[Crawler Embeddings] Batch error:', error);
    throw new Error(`Failed to generate batch embeddings: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Get model information
 */
export function getModelInfo() {
  return {
    modelName: MODEL,
    embeddingDim: EMBEDDING_DIM,
    isInitialized: PipelineSingleton.instance !== null,
    isInitializing: PipelineSingleton.isInitializing,
  };
}
