/**
 * Embedding generation for crawler service
 * Uses @huggingface/transformers with WASM backend for Next.js serverless
 * 
 * IMPORTANT: No external API calls - runs entirely locally using WASM backend
 */

import { pipeline, env } from '@huggingface/transformers';

// Configure transformers.js environment for Vercel serverless
env.allowLocalModels = false;
env.allowRemoteModels = true;
env.useBrowserCache = false;
env.cacheDir = '/tmp/.transformers-cache';

const MODEL = 'Xenova/bge-small-en-v1.5'; // 384-dim
const EMBEDDING_DIM = 384;

let pipeline_instance: any = null;
let isInitializing = false;

/**
 * Generate 384-dim embedding for document chunks
 * Compatible with main app's query embeddings
 * 
 * This function ONLY uses local transformers - no external API calls
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  try {
    // Initialize model if needed (with proper locking)
    if (!pipeline_instance) {
      // Wait if another initialization is in progress
      while (isInitializing) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      // Double-check after waiting
      if (!pipeline_instance) {
        try {
          isInitializing = true;
          console.log('[Crawler Embeddings] Initializing bge-small-en-v1.5 (384-dim)...');
          
          // Initialize pipeline - transformers.js automatically uses WASM in Node.js
          pipeline_instance = await pipeline('feature-extraction', MODEL, {
            dtype: 'q8', // Quantized 8-bit for efficiency
          });
          
          console.log('[Crawler Embeddings] ✅ bge-small-en-v1.5 model ready');
        } catch (error) {
          console.error('[Crawler Embeddings] Failed to initialize model:', error);
          pipeline_instance = null;
          throw error;
        } finally {
          isInitializing = false;
        }
      }
    }
    
    console.log(`[Crawler Embeddings] Generating embedding for: "${text.substring(0, 50)}..."`);
    
    // Add "passage:" prefix for document embeddings (BGE model requirement)
    const prefixedText = `passage: ${text}`;
    
    const output = await pipeline_instance(prefixedText, {
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
    console.error('[Crawler Embeddings] Error generating embedding:', error);
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
    isInitialized: pipeline_instance !== null,
    isInitializing,
  };
}
