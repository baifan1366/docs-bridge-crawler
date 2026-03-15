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
  try {
    console.log(`[Crawler Embeddings] Generating embedding for: "${text.substring(0, 50)}..."`);
    
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
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`E5 API error (${response.status}): ${errorText}`);
    }
    
    const data = await response.json();
    const embedding = data.embedding as number[];
    
    if (!embedding || !Array.isArray(embedding)) {
      throw new Error('Invalid response format from E5 API');
    }
    
    if (embedding.length !== EMBEDDING_DIM_SMALL) {
      throw new Error(`Expected ${EMBEDDING_DIM_SMALL}-dim embedding, got ${embedding.length}-dim`);
    }
    
    console.log(`[Crawler Embeddings] ✅ Generated ${embedding.length}-dim embedding`);
    return embedding;
  } catch (error) {
    console.error('[Crawler Embeddings] Error generating embedding:', error);
    throw new Error(`Failed to generate embedding: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Generate 1024-dim embedding using BGE-M3 API
 */
export async function generateEmbeddingLarge(text: string): Promise<number[]> {
  try {
    console.log(`[Crawler Embeddings] Generating large embedding for: "${text.substring(0, 50)}..."`);
    
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
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`BGE API error (${response.status}): ${errorText}`);
    }
    
    const data = await response.json();
    const embedding = data.embedding as number[];
    
    if (!embedding || !Array.isArray(embedding)) {
      throw new Error('Invalid response format from BGE API');
    }
    
    if (embedding.length !== EMBEDDING_DIM_LARGE) {
      throw new Error(`Expected ${EMBEDDING_DIM_LARGE}-dim embedding, got ${embedding.length}-dim`);
    }
    
    console.log(`[Crawler Embeddings] ✅ Generated ${embedding.length}-dim large embedding`);
    return embedding;
  } catch (error) {
    console.error('[Crawler Embeddings] Error generating large embedding:', error);
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
  try {
    console.log(`[Crawler Embeddings] Generating dual embeddings...`);
    
    // Generate both embeddings in parallel
    const [small, large] = await Promise.all([
      generateEmbedding(text),
      generateEmbeddingLarge(text)
    ]);
    
    console.log(`[Crawler Embeddings] ✅ Generated dual embeddings: ${small.length}-dim + ${large.length}-dim`);
    
    return { small, large };
  } catch (error) {
    console.error('[Crawler Embeddings] Error generating dual embeddings:', error);
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
