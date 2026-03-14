/**
 * Embedding generation for crawler service
 * Uses @huggingface/transformers with WASM backend for Next.js serverless
 * 
 * IMPORTANT: No external API calls - runs entirely locally using WASM backend
 */

const MODEL = 'Xenova/bge-small-en-v1.5'; // 384-dim
const EMBEDDING_DIM = 384;

let pipeline_instance: any = null;
let isInitializing = false;
let transformersAvailable: boolean | null = null;

// Dynamically import and configure transformers
async function getTransformersModule() {
  const { pipeline, env } = await import('@huggingface/transformers');
  
  // Configure environment for serverless (Vercel) - following official docs
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  env.useBrowserCache = false;
  env.cacheDir = '/tmp/.transformers-cache';
  
  // WASM backend is automatically used in Node.js environment
  // No need to manually configure backends - transformers.js handles this
  
  return { pipeline, env };
}

// Check if transformers is available
async function checkTransformersAvailability() {
  // Return cached result if already checked
  if (transformersAvailable !== null) {
    return transformersAvailable ? await getTransformersModule() : null;
  }
  
  try {
    const transformers = await getTransformersModule();
    transformersAvailable = true;
    return transformers;
  } catch (error) {
    console.error('[Crawler Embeddings] Transformers not available:', error instanceof Error ? error.message : String(error));
    transformersAvailable = false;
    return null;
  }
}

/**
 * Generate 384-dim embedding for document chunks
 * Compatible with main app's query embeddings
 * 
 * This function ONLY uses local transformers - no external API calls
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  try {
    // Check if transformers is available
    const transformers = await checkTransformersAvailability();
    if (!transformers) {
      throw new Error('Transformers library not available. Please ensure @huggingface/transformers and its dependencies are properly installed.');
    }
    
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
          pipeline_instance = await transformers.pipeline('feature-extraction', MODEL, {
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
    transformersAvailable,
  };
}
