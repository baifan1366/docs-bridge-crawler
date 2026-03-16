import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { generateDualEmbeddings } from '@/lib/embeddings/generator';

export async function POST(request: NextRequest) {
  try {
    const { query, options = {} } = await request.json();

    if (!query || typeof query !== 'string') {
      return NextResponse.json(
        { error: 'Query is required and must be a string' },
        { status: 400 }
      );
    }

    const {
      match_count = 10,
      user_id = null,
      active_folder_ids = null,
      search_type = 'smart', // 'smart', 'hybrid', 'vector', 'bm25'
      vector_weight = 0.7,
      bm25_weight = 0.3,
      vector_threshold = 0.5,
      use_simple_search = false
    } = options;

    const supabase = await createClient();

    let results;

    if (search_type === 'bm25') {
      // Pure BM25 keyword search
      const { data, error } = await supabase.rpc('search_chunks_bm25', {
        search_query: query,
        match_count,
        p_user_id: user_id,
        active_folder_ids,
        use_simple_search
      });

      if (error) throw error;
      results = data;

    } else if (search_type === 'vector') {
      // Pure vector search
      const { small } = await generateDualEmbeddings(query);
      
      const { data, error } = await supabase.rpc('search_chunks_small', {
        query_embedding: small,
        match_threshold: vector_threshold,
        match_count,
        user_id_param: user_id,
        active_folder_ids
      });

      if (error) throw error;
      results = data;

    } else if (search_type === 'hybrid') {
      // Manual hybrid search with custom weights
      const { small } = await generateDualEmbeddings(query);
      
      const { data, error } = await supabase.rpc('hybrid_search_chunks', {
        query_text: query,
        query_embedding: small,
        match_count,
        p_user_id: user_id,
        active_folder_ids,
        vector_weight,
        bm25_weight,
        vector_threshold,
        use_simple_search
      });

      if (error) throw error;
      results = data;

    } else {
      // Smart hybrid search (default)
      const { small } = await generateDualEmbeddings(query);
      
      const { data, error } = await supabase.rpc('smart_hybrid_search', {
        query_text: query,
        query_embedding: small,
        match_count,
        p_user_id: user_id,
        active_folder_ids
      });

      if (error) throw error;
      results = data;
    }

    return NextResponse.json({
      success: true,
      query,
      search_type,
      results: results || [],
      count: results?.length || 0,
      metadata: {
        search_options: {
          match_count,
          user_id,
          active_folder_ids,
          search_type,
          vector_weight,
          bm25_weight,
          vector_threshold,
          use_simple_search
        }
      }
    });

  } catch (error) {
    console.error('[HYBRID-SEARCH] Error:', error);
    return NextResponse.json(
      { 
        error: 'Search failed', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get('q');
  
  if (!query) {
    return NextResponse.json(
      { error: 'Query parameter "q" is required' },
      { status: 400 }
    );
  }

  const options = {
    match_count: parseInt(searchParams.get('limit') || '10'),
    search_type: searchParams.get('type') || 'smart',
    vector_weight: parseFloat(searchParams.get('vector_weight') || '0.7'),
    bm25_weight: parseFloat(searchParams.get('bm25_weight') || '0.3'),
    use_simple_search: searchParams.get('simple') === 'true'
  };

  // Reuse POST logic
  const mockRequest = {
    json: async () => ({ query, options })
  } as NextRequest;

  return POST(mockRequest);
}