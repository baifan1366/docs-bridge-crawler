import HybridSearchDemo from '@/components/admin/HybridSearchDemo';

export default function HybridSearchPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-4">
            混合搜索系统 (Hybrid Search System)
          </h1>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h2 className="font-semibold text-blue-900 mb-2">关于混合搜索</h2>
            <p className="text-blue-800 text-sm mb-2">
              混合搜索结合了向量搜索和BM25关键词搜索的优势，解决了纯向量搜索在处理数字、名称、政策编号等精确匹配时的不足。
            </p>
            <ul className="text-blue-800 text-sm space-y-1">
              <li>• <strong>向量搜索</strong>：适合语义理解和概念匹配</li>
              <li>• <strong>BM25搜索</strong>：适合精确关键词、数字、代码匹配</li>
              <li>• <strong>智能混合</strong>：自动检测查询类型并调整权重</li>
              <li>• <strong>手动混合</strong>：可自定义向量和BM25的权重比例</li>
            </ul>
          </div>
        </div>
        
        <HybridSearchDemo />
        
        <div className="mt-8 bg-white rounded-lg shadow-lg p-6">
          <h2 className="text-xl font-bold mb-4">技术实现</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h3 className="font-semibold mb-2">数据库层面</h3>
              <ul className="text-sm text-gray-600 space-y-1">
                <li>• PostgreSQL + pgvector 向量扩展</li>
                <li>• tsvector 全文搜索索引</li>
                <li>• GIN 索引优化关键词搜索</li>
                <li>• HNSW 索引优化向量搜索</li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold mb-2">搜索策略</h3>
              <ul className="text-sm text-gray-600 space-y-1">
                <li>• 自动检测数字、代码、精确匹配</li>
                <li>• 动态调整向量/BM25权重</li>
                <li>• 支持简单和复杂分词模式</li>
                <li>• 结果去重和排序优化</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}