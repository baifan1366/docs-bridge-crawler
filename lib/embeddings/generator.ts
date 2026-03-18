/**
 * Embedding generation for crawler service
 * Uses Hugging Face Space API with multilingual-e5-small model
 * 
 * Model: intfloat/multilingual-e5-small (384-dim)
 * Task: passage (for document/chunk embeddings)
 */

const E5_API_URL = process.env.E5_HG_EMBEDDING_SERVER_API_URL || 'https://edusocial-e5-small-embedding-server.hf.space';
const BGE_API_URL = process.env.BGE_HG_EMBEDDING_SERVER_API_URL || 'https://edusocial-bge-m3-embedding-server.hf.space';
const EMBEDDING_DIM_SMALL = 384;
const EMBEDDING_DIM_LARGE = 1024;

/**
 * Generate 384-dim embedding for document chunks using E5 API
 * Automatically adds "passage: " prefix for document embeddings
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const startTime = Date.now();
  try {
    console.log(`[EMBEDDINGS-E5] 🔄 Generating small embedding (${text.length} chars)...`);
    console.log(`[EMBEDDINGS-E5] 🌐 API URL: ${E5_API_URL}/embed`);
    
    const response = await fetch(`${E5_API_URL}/embed`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: text,
        task: 'passage', // Document/passage embeddings
      }),
    });
    
    const duration = Date.now() - startTime;
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[EMBEDDINGS-E5] ❌ API error (${response.status}) after ${duration}ms: ${errorText}`);
      throw new Error(`E5 API error (${response.status}): ${errorText}`);
    }
    
    const data = await response.json();
    const embedding = data.embedding as number[];
    
    if (!embedding || !Array.isArray(embedding)) {
      console.error(`[EMBEDDINGS-E5] ❌ Invalid response format after ${duration}ms:`, data);
      throw new Error('Invalid response format from E5 API');
    }
    
    if (embedding.length !== EMBEDDING_DIM_SMALL) {
      console.error(`[EMBEDDINGS-E5] ❌ Wrong dimension after ${duration}ms: got ${embedding.length}, expected ${EMBEDDING_DIM_SMALL}`);
      throw new Error(`Expected ${EMBEDDING_DIM_SMALL}-dim embedding, got ${embedding.length}-dim`);
    }
    
    console.log(`[EMBEDDINGS-E5] ✅ Generated ${embedding.length}-dim embedding in ${duration}ms`);
    console.log(`[EMBEDDINGS-E5] 📊 Vector stats: min=${Math.min(...embedding).toFixed(4)}, max=${Math.max(...embedding).toFixed(4)}`);
    return embedding;
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[EMBEDDINGS-E5] ❌ Error after ${duration}ms:`, error);
    throw new Error(`Failed to generate embedding: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Generate 1024-dim embedding using BGE-M3 API
 */
export async function generateEmbeddingLarge(text: string): Promise<number[]> {
  const startTime = Date.now();
  try {
    console.log(`[EMBEDDINGS-BGE] 🔄 Generating large embedding (${text.length} chars)...`);
    console.log(`[EMBEDDINGS-BGE] 🌐 API URL: ${BGE_API_URL}/embed`);
    
    const response = await fetch(`${BGE_API_URL}/embed`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: text,
        task: 'passage',
      }),
    });
    
    const duration = Date.now() - startTime;
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[EMBEDDINGS-BGE] ❌ API error (${response.status}) after ${duration}ms: ${errorText}`);
      throw new Error(`BGE API error (${response.status}): ${errorText}`);
    }
    
    const data = await response.json();
    const embedding = data.embedding as number[];
    
    if (!embedding || !Array.isArray(embedding)) {
      console.error(`[EMBEDDINGS-BGE] ❌ Invalid response format after ${duration}ms:`, data);
      throw new Error('Invalid response format from BGE API');
    }
    
    if (embedding.length !== EMBEDDING_DIM_LARGE) {
      console.error(`[EMBEDDINGS-BGE] ❌ Wrong dimension after ${duration}ms: got ${embedding.length}, expected ${EMBEDDING_DIM_LARGE}`);
      throw new Error(`Expected ${EMBEDDING_DIM_LARGE}-dim embedding, got ${embedding.length}-dim`);
    }
    
    console.log(`[EMBEDDINGS-BGE] ✅ Generated ${embedding.length}-dim large embedding in ${duration}ms`);
    console.log(`[EMBEDDINGS-BGE] 📊 Vector stats: min=${Math.min(...embedding).toFixed(4)}, max=${Math.max(...embedding).toFixed(4)}`);
    return embedding;
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[EMBEDDINGS-BGE] ❌ Error after ${duration}ms:`, error);
    throw new Error(`Failed to generate large embedding: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Generate both small and large embeddings for a text
 */
export async function generateDualEmbeddings(text: string): Promise<{
  small: number[];
  large: number[];
}> {
  const startTime = Date.now();
  try {
    console.log(`[EMBEDDINGS] 🧠 Generating dual embeddings for text (${text.length} chars)...`);
    console.log(`[EMBEDDINGS] 📝 Text preview: "${text.substring(0, 100)}..."`);
    
    // Generate both embeddings in parallel
    console.log(`[EMBEDDINGS] 🚀 Starting parallel embedding generation...`);
    const parallelStartTime = Date.now();
    
    const [small, large] = await Promise.all([
      generateEmbedding(text),
      generateEmbeddingLarge(text)
    ]);
    
    const parallelDuration = Date.now() - parallelStartTime;
    const totalDuration = Date.now() - startTime;
    
    console.log(`[EMBEDDINGS] ✅ Generated dual embeddings in ${totalDuration}ms (parallel: ${parallelDuration}ms)`);
    console.log(`[EMBEDDINGS] 📊 Results: ${small.length}-dim + ${large.length}-dim vectors`);
    console.log(`[EMBEDDINGS] 🔢 Small embedding sample: [${small.slice(0, 5).map(n => n.toFixed(4)).join(', ')}...]`);
    console.log(`[EMBEDDINGS] 🔢 Large embedding sample: [${large.slice(0, 5).map(n => n.toFixed(4)).join(', ')}...]`);
    
    return { small, large };
  } catch (error) {
    const totalDuration = Date.now() - startTime;
    console.error(`[EMBEDDINGS] ❌ Failed to generate dual embeddings after ${totalDuration}ms:`, error);
    throw new Error(`Failed to generate dual embeddings: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Batch generate embeddings for multiple texts
 * More efficient than calling generateEmbedding multiple times
 */
export async function generateEmbeddingsBatch(texts: string[]): Promise<number[][]> {
  try {
    console.log(`[Crawler Embeddings] Generating batch embeddings for ${texts.length} texts...`);
    
    const response = await fetch(`${E5_API_URL}/embed/batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inputs: texts,
        task: 'passage', // Document/passage embeddings
      }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`E5 API error (${response.status}): ${errorText}`);
    }
    
    const data = await response.json();
    const embeddings = data.embeddings as number[][];
    
    if (!embeddings || !Array.isArray(embeddings)) {
      throw new Error('Invalid response format from E5 API');
    }
    
    if (embeddings.length !== texts.length) {
      throw new Error(`Expected ${texts.length} embeddings, got ${embeddings.length}`);
    }
    
    // Validate each embedding
    for (let i = 0; i < embeddings.length; i++) {
      if (embeddings[i].length !== EMBEDDING_DIM_SMALL) {
        throw new Error(`Embedding ${i} has wrong dimension: ${embeddings[i].length} (expected ${EMBEDDING_DIM_SMALL})`);
      }
    }
    
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
    small: {
      modelName: 'intfloat/multilingual-e5-small',
      embeddingDim: EMBEDDING_DIM_SMALL,
      apiUrl: E5_API_URL,
      task: 'passage',
    },
    large: {
      modelName: 'BAAI/bge-m3',
      embeddingDim: EMBEDDING_DIM_LARGE,
      apiUrl: BGE_API_URL,
      task: 'passage',
    }
  };
}
