'use client';

import { useState } from 'react';

interface SearchResult {
  chunk_id: string;
  document_id: string;
  chunk_text: string;
  vector_score?: number;
  bm25_score?: number;
  hybrid_score?: number;
  title: string;
  source_url: string;
  document_type: string;
  chunk_index: number;
  section_heading?: string;
  search_strategy?: string;
}

interface SearchResponse {
  success: boolean;
  query: string;
  search_type: string;
  results: SearchResult[];
  count: number;
  metadata: {
    search_options: any;
  };
  error?: string; // 添加可选的error属性
}

export default function HybridSearchDemo() {
  const [query, setQuery] = useState('');
  const [searchType, setSearchType] = useState('smart');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTime, setSearchTime] = useState<number | null>(null);

  const handleSearch = async () => {
    if (!query.trim()) return;

    setLoading(true);
    setError(null);
    const startTime = Date.now();

    try {
      const response = await fetch('/api/search/hybrid', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: query.trim(),
          options: {
            search_type: searchType,
            match_count: 10,
            vector_weight: 0.7,
            bm25_weight: 0.3,
            use_simple_search: searchType === 'bm25'
          }
        }),
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Search failed');
      }

      setResults(data.results);
      setSearchTime(Date.now() - startTime);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const getScoreColor = (score: number) => {
    if (score > 0.8) return 'text-green-600';
    if (score > 0.6) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getStrategyBadge = (strategy?: string) => {
    if (!strategy) return null;
    
    const colors = {
      'keyword_boosted': 'bg-blue-100 text-blue-800',
      'semantic_primary': 'bg-green-100 text-green-800'
    };
    
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${colors[strategy as keyof typeof colors] || 'bg-gray-100 text-gray-800'}`}>
        {strategy.replace('_', ' ')}
      </span>
    );
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="bg-white rounded-lg shadow-lg p-6">
        <h2 className="text-2xl font-bold mb-6">混合搜索演示 (Hybrid Search Demo)</h2>
        
        {/* Search Input */}
        <div className="mb-6">
          <div className="flex gap-4 mb-4">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="输入搜索查询... (例如: MySejahtera BR1M Act 342)"
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <select
              value={searchType}
              onChange={(e) => setSearchType(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              <option value="smart">智能混合 (Smart Hybrid)</option>
              <option value="hybrid">手动混合 (Manual Hybrid)</option>
              <option value="vector">纯向量 (Vector Only)</option>
              <option value="bm25">纯关键词 (BM25 Only)</option>
            </select>
            <button
              onClick={handleSearch}
              disabled={loading || !query.trim()}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? '搜索中...' : '搜索'}
            </button>
          </div>
          
          {/* Search Type Description */}
          <div className="text-sm text-gray-600">
            {searchType === 'smart' && '🧠 智能混合：自动检测查询类型，为数字、代码、精确匹配优化关键词搜索'}
            {searchType === 'hybrid' && '⚖️ 手动混合：结合向量相似度和BM25关键词匹配'}
            {searchType === 'vector' && '🎯 纯向量：基于语义相似度的搜索'}
            {searchType === 'bm25' && '🔤 纯关键词：基于BM25算法的全文搜索，适合精确匹配'}
          </div>
        </div>

        {/* Results */}
        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-red-800">错误: {error}</p>
          </div>
        )}

        {searchTime !== null && (
          <div className="mb-4 text-sm text-gray-600">
            搜索完成，用时 {searchTime}ms，找到 {results.length} 个结果
          </div>
        )}

        {results.length > 0 && (
          <div className="space-y-4">
            {results.map((result, index) => (
              <div key={result.chunk_id} className="border border-gray-200 rounded-lg p-4">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1">
                    <h3 className="font-semibold text-lg text-gray-900 mb-1">
                      {result.title}
                    </h3>
                    <div className="flex items-center gap-2 text-sm text-gray-600 mb-2">
                      <span>#{index + 1}</span>
                      <span>•</span>
                      <span>Chunk {result.chunk_index}</span>
                      {result.section_heading && (
                        <>
                          <span>•</span>
                          <span>{result.section_heading}</span>
                        </>
                      )}
                      {getStrategyBadge(result.search_strategy)}
                    </div>
                  </div>
                  
                  {/* Scores */}
                  <div className="text-right text-sm">
                    {result.vector_score !== undefined && (
                      <div className={`${getScoreColor(result.vector_score)}`}>
                        向量: {result.vector_score.toFixed(3)}
                      </div>
                    )}
                    {result.bm25_score !== undefined && (
                      <div className={`${getScoreColor(result.bm25_score)}`}>
                        BM25: {result.bm25_score.toFixed(3)}
                      </div>
                    )}
                    {result.hybrid_score !== undefined && (
                      <div className={`font-semibold ${getScoreColor(result.hybrid_score)}`}>
                        混合: {result.hybrid_score.toFixed(3)}
                      </div>
                    )}
                  </div>
                </div>
                
                <p className="text-gray-700 mb-2">
                  {result.chunk_text.length > 300 
                    ? result.chunk_text.substring(0, 300) + '...'
                    : result.chunk_text
                  }
                </p>
                
                {result.source_url && (
                  <a 
                    href={result.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:text-blue-800 text-sm"
                  >
                    查看原文 →
                  </a>
                )}
              </div>
            ))}
          </div>
        )}

        {results.length === 0 && !loading && !error && query && (
          <div className="text-center py-8 text-gray-500">
            没有找到相关结果
          </div>
        )}

        {/* Example Queries */}
        <div className="mt-8 p-4 bg-gray-50 rounded-lg">
          <h3 className="font-semibold mb-2">示例查询:</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
            <button
              onClick={() => setQuery('MySejahtera BR1M Act 342')}
              className="text-left p-2 hover:bg-gray-100 rounded"
            >
              🔢 MySejahtera BR1M Act 342 (数字/代码)
            </button>
            <button
              onClick={() => setQuery('how to apply for government assistance')}
              className="text-left p-2 hover:bg-gray-100 rounded"
            >
              🧠 how to apply for government assistance (语义)
            </button>
            <button
              onClick={() => setQuery('eligibility criteria financial aid')}
              className="text-left p-2 hover:bg-gray-100 rounded"
            >
              📋 eligibility criteria financial aid (混合)
            </button>
            <button
              onClick={() => setQuery('"exact phrase matching"')}
              className="text-left p-2 hover:bg-gray-100 rounded"
            >
              📝 "exact phrase matching" (精确匹配)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}