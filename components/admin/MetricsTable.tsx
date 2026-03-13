import { createClient } from '@/lib/supabase/server';

export default async function MetricsTable() {
  const supabase = await createClient();
  const { data: metrics } = await supabase
    .from('crawler_metrics')
    .select('*')
    .order('timestamp', { ascending: false })
    .limit(100);

  if (!metrics || metrics.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-slate-200 p-12 text-center">
        <p className="text-slate-600">No metrics data available</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-200">
        <h3 className="text-lg font-semibold text-slate-900">Recent Metrics</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase">URL</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase">Status</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase">Duration</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase">Chunks</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase">Method</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase">Confidence</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase">Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {metrics.map((metric: any) => (
              <tr key={metric.id} className="hover:bg-slate-50">
                <td className="px-6 py-4 text-sm text-slate-900 max-w-xs truncate">
                  {metric.url}
                </td>
                <td className="px-6 py-4">
                  <span className={`px-2 py-1 text-xs font-medium rounded ${
                    metric.status === 'success' ? 'bg-green-100 text-green-700' :
                    metric.status === 'failed' ? 'bg-red-100 text-red-700' :
                    'bg-yellow-100 text-yellow-700'
                  }`}>
                    {metric.status}
                  </span>
                </td>
                <td className="px-6 py-4 text-sm text-slate-600">
                  {(metric.duration_ms / 1000).toFixed(2)}s
                </td>
                <td className="px-6 py-4 text-sm text-slate-600">
                  {metric.chunks_created || 0}
                </td>
                <td className="px-6 py-4 text-sm text-slate-600">
                  {metric.extraction_method || 'N/A'}
                </td>
                <td className="px-6 py-4 text-sm text-slate-600">
                  {metric.extraction_confidence ? `${(metric.extraction_confidence * 100).toFixed(0)}%` : 'N/A'}
                </td>
                <td className="px-6 py-4 text-sm text-slate-600">
                  {new Date(metric.timestamp).toLocaleTimeString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
