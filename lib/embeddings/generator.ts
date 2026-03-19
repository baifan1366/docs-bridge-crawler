/**
 * Embedding generation for crawler service
 * Uses Hugging Face Space API with multilingual-e5-small model
 */

const E5_API_URL = process.env.E5_HG_EMBEDDING_SERVER_API_URL || 'https://edusocial-e5-small-embedding-server.hf.space';
const BGE_API_URL = process.env.BGE_HG_EMBEDDING_SERVER_API_URL || 'https://edusocial-bge-m3-embedding-server.hf.space';
const EMBEDDING_DIM_SMALL = 384;
const EMBEDDING_DIM_LARGE = 1024;

export async function generateEmbedding(text: string): Promise<number[]> {
  try {
    const response = await fetch(`${E5_API_URL}/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: text, task: 'passage' }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[EMBEDDINGS-E5] API error (${response.status}): ${errorText}`);
      throw new Error(`E5 API error (${response.status})`);
    }
    
    const data = await response.json();
    const embedding = data.embedding as number[];
    
    if (!embedding || !Array.isArray(embedding)) {
      console.error('[EMBEDDINGS-E5] Invalid response format');
      throw new Error('Invalid response format from E5 API');
    }
    
    if (embedding.length !== EMBEDDING_DIM_SMALL) {
      console.error(`[EMBEDDINGS-E5] Wrong dimension: got ${embedding.length}, expected ${EMBEDDING_DIM_SMALL}`);
      throw new Error(`Expected ${EMBEDDING_DIM_SMALL}-dim embedding`);
    }
    
    return embedding;
  } catch (error) {
    console.error('[EMBEDDINGS-E5] Error:', error);
    throw new Error(`Failed to generate embedding: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function generateEmbeddingLarge(text: string): Promise<number[]> {
  try {
    const response = await fetch(`${BGE_API_URL}/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: text, task: 'passage' }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[EMBEDDINGS-BGE] API error (${response.status}): ${errorText}`);
      throw new Error(`BGE API error (${response.status})`);
    }
    
    const data = await response.json();
    const embedding = data.embedding as number[];
    
    if (!embedding || !Array.isArray(embedding)) {
      console.error('[EMBEDDINGS-BGE] Invalid response format');
      throw new Error('Invalid response format from BGE API');
    }
    
    if (embedding.length !== EMBEDDING_DIM_LARGE) {
      console.error(`[EMBEDDINGS-BGE] Wrong dimension: got ${embedding.length}, expected ${EMBEDDING_DIM_LARGE}`);
      throw new Error(`Expected ${EMBEDDING_DIM_LARGE}-dim embedding`);
    }
    
    return embedding;
  } catch (error) {
    console.error('[EMBEDDINGS-BGE] Error:', error);
    throw new Error(`Failed to generate large embedding: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function generateDualEmbeddings(text: string): Promise<{ small: number[]; large: number[] }> {
  try {
    const [small, large] = await Promise.all([
      generateEmbedding(text),
      generateEmbeddingLarge(text)
    ]);
    return { small, large };
  } catch (error) {
    console.error('[EMBEDDINGS] Failed to generate dual embeddings:', error);
    throw new Error(`Failed to generate dual embeddings: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function generateEmbeddingsBatch(texts: string[]): Promise<number[][]> {
  try {
    const response = await fetch(`${E5_API_URL}/embed/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs: texts, task: 'passage' }),
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
    
    for (let i = 0; i < embeddings.length; i++) {
      if (embeddings[i].length !== EMBEDDING_DIM_SMALL) {
        throw new Error(`Embedding ${i} has wrong dimension: ${embeddings[i].length}`);
      }
    }
    
    return embeddings;
  } catch (error) {
    console.error('[Crawler Embeddings] Batch error:', error);
    throw new Error(`Failed to generate batch embeddings: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export function getModelInfo() {
  return {
    small: { modelName: 'intfloat/multilingual-e5-small', embeddingDim: EMBEDDING_DIM_SMALL, apiUrl: E5_API_URL, task: 'passage' },
    large: { modelName: 'BAAI/bge-m3', embeddingDim: EMBEDDING_DIM_LARGE, apiUrl: BGE_API_URL, task: 'passage' }
  };
}