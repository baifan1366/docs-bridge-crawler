import { createClient } from '@/lib/supabase/server';

export default async function MetricsCharts() {
  const supabase = await createClient();
  const { data: metrics } = await supabase
    .from('crawler_metrics')
    .select('*')
    .gte('timestamp', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
    .order('timestamp', { ascending: true });

  if (!metrics || metrics.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-slate-200 p-12 text-center">
        <p className="text-slate-600">No metrics data available</p>
      </div>
    );
  }

  // Group by day
  const dailyStats = metrics.reduce((acc: any, metric: any) => {
    const date = new Date(metric.timestamp).toLocaleDateString();
    if (!acc[date]) {
      acc[date] = { success: 0, failed: 0, skipped: 0, total: 0, totalDuration: 0, totalChunks: 0 };
    }
    acc[date][metric.status] = (acc[date][metric.status] || 0) + 1;
    acc[date].total += 1;
    acc[date].totalDuration += metric.duration_ms || 0;
    acc[date].totalChunks += metric.chunks_created || 0;
    return acc;
  }, {});

  const days = Object.keys(dailyStats).slice(-7);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Success Rate Chart */}
      <div className="bg-white rounded-lg border border-slate-200 p-6">
        <h3 className="text-lg font-semibold text-slate-900 mb-4">Success Rate (7 Days)</h3>
        <div className="space-y-3">
          {days.map(day => {
            const stats = dailyStats[day];
            const successRate = ((stats.success / stats.total) * 100).toFixed(1);
            return (
              <div key={day}>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="text-slate-600">{day}</span>
                  <span className="font-medium text-slate-900">{successRate}%</span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-2">
                  <div 
                    className="bg-green-500 h-2 rounded-full transition-all"
                    style={{ width: `${successRate}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Daily Crawls Chart */}
      <div className="bg-white rounded-lg border border-slate-200 p-6">
        <h3 className="text-lg font-semibold text-slate-900 mb-4">Daily Crawls</h3>
        <div className="space-y-3">
          {days.map(day => {
            const stats = dailyStats[day];
            const maxTotal = Math.max(...Object.values(dailyStats).map((s: any) => s.total));
            return (
              <div key={day}>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="text-slate-600">{day}</span>
                  <span className="font-medium text-slate-900">{stats.total} crawls</span>
                </div>
                <div className="flex gap-1">
                  <div 
                    className="bg-green-500 h-2 rounded-l transition-all"
                    style={{ width: `${(stats.success / maxTotal) * 100}%` }}
                    title={`${stats.success} success`}
                  />
                  <div 
                    className="bg-red-500 h-2 transition-all"
                    style={{ width: `${(stats.failed / maxTotal) * 100}%` }}
                    title={`${stats.failed} failed`}
                  />
                  <div 
                    className="bg-yellow-500 h-2 rounded-r transition-all"
                    style={{ width: `${(stats.skipped / maxTotal) * 100}%` }}
                    title={`${stats.skipped} skipped`}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
