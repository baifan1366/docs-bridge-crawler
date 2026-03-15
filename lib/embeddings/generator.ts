/**
 * Embedding generation for crawler service
 * Uses Hugging Face Space API with multilingual-e5-small model
 * 
 * Model: intfloat/multilingual-e5-small (384-dim)
 * Task: passage (for document/chunk embeddings)
 */

const E5_API_URL = process.env.E5_HG_EMBEDDING_SERVER_API_URL || 'https://edusocial-e5-small-embedding-server.hf.space';
const EMBEDDING_DIM = 384;

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
      if (embeddings[i].length !== EMBEDDING_DIM) {
        throw new Error(`Embedding ${i} has wrong dimension: ${embeddings[i].length} (expected ${EMBEDDING_DIM})`);
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
    modelName: 'intfloat/multilingual-e5-small',
    embeddingDim: EMBEDDING_DIM,
    apiUrl: E5_API_URL,
    task: 'passage',
  };
}
