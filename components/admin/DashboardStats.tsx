import { createClient } from '@/lib/supabase/server';

export default async function DashboardStats() {
  const supabase = await createClient();
  // Get stats from last 24 hours
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [metricsResult, sourcesResult, pagesResult] = await Promise.all([
    supabase
      .from('crawler_metrics')
      .select('status, duration_ms, chunks_created')
      .gte('timestamp', oneDayAgo),
    supabase
      .from('crawler_sources')
      .select('id, is_active'),
    supabase
      .from('crawler_pages')
      .select('crawl_status')
      .gte('last_crawled_at', oneDayAgo)
  ]);

  const metrics = metricsResult.data || [];
  const sources = sourcesResult.data || [];
  const pages = pagesResult.data || [];

  const totalCrawls = metrics.length;
  const successfulCrawls = metrics.filter(m => m.status === 'success').length;
  const failedCrawls = metrics.filter(m => m.status === 'failed').length;
  const totalChunks = metrics.reduce((sum, m) => sum + (m.chunks_created || 0), 0);
  const avgDuration = metrics.length > 0 
    ? Math.round(metrics.reduce((sum, m) => sum + (m.duration_ms || 0), 0) / metrics.length)
    : 0;
  const successRate = totalCrawls > 0 ? ((successfulCrawls / totalCrawls) * 100).toFixed(1) : '0';
  const activeSources = sources.filter(s => s.is_active).length;

  const stats = [
    { label: 'Total Crawls (24h)', value: totalCrawls.toLocaleString(), change: '+12%', positive: true },
    { label: 'Success Rate', value: `${successRate}%`, change: successRate, positive: parseFloat(successRate) > 90 },
    { label: 'Total Chunks', value: totalChunks.toLocaleString(), change: `${successfulCrawls} pages`, positive: true },
    { label: 'Avg Duration', value: `${(avgDuration / 1000).toFixed(1)}s`, change: `${avgDuration}ms`, positive: avgDuration < 2000 },
    { label: 'Active Sources', value: activeSources.toString(), change: `${sources.length} total`, positive: true },
    { label: 'Failed Crawls', value: failedCrawls.toString(), change: `${((failedCrawls / totalCrawls) * 100).toFixed(1)}%`, positive: failedCrawls === 0 }
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {stats.map((stat, index) => (
        <div key={index} className="bg-white rounded-lg border border-slate-200 p-6">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-slate-600">{stat.label}</p>
            <span className={`text-xs font-medium px-2 py-1 rounded ${
              stat.positive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
            }`}>
              {stat.change}
            </span>
          </div>
          <p className="text-3xl font-bold text-slate-900 mt-2">{stat.value}</p>
        </div>
      ))}
    </div>
  );
}
