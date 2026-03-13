import { createClient } from '@/lib/supabase/server';

export default async function RecentActivity() {
  const supabase = await createClient();
  const { data: recentPages } = await supabase
    .from('crawler_pages')
    .select('url, title, crawl_status, last_crawled_at')
    .order('last_crawled_at', { ascending: false })
    .limit(10);

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-6">
      <h2 className="text-lg font-semibold text-slate-900 mb-6">Recent Activity</h2>

      <div className="space-y-3">
        {recentPages && recentPages.length > 0 ? (
          recentPages.map((page: any, index: number) => (
            <div key={index} className="flex items-start gap-3 p-3 hover:bg-slate-50 rounded-lg transition-colors">
              <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${
                page.crawl_status === 'success' ? 'bg-green-500' :
                page.crawl_status === 'failed' ? 'bg-red-500' :
                page.crawl_status === 'skipped' ? 'bg-yellow-500' :
                'bg-slate-300'
              }`} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-900 truncate">
                  {page.title || 'Untitled'}
                </p>
                <p className="text-xs text-slate-600 truncate mt-1">
                  {page.url}
                </p>
              </div>
              <div className="text-right flex-shrink-0">
                <span className={`text-xs font-medium px-2 py-1 rounded ${
                  page.crawl_status === 'success' ? 'bg-green-100 text-green-700' :
                  page.crawl_status === 'failed' ? 'bg-red-100 text-red-700' :
                  page.crawl_status === 'skipped' ? 'bg-yellow-100 text-yellow-700' :
                  'bg-slate-100 text-slate-600'
                }`}>
                  {page.crawl_status}
                </span>
                <p className="text-xs text-slate-500 mt-1">
                  {formatTime(page.last_crawled_at)}
                </p>
              </div>
            </div>
          ))
        ) : (
          <p className="text-center text-slate-600 py-8">No recent activity</p>
        )}
      </div>
    </div>
  );
}
