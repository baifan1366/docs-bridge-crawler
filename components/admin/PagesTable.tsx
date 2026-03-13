import { createClient } from '@/lib/supabase/server';

export default async function PagesTable() {
  const supabase = await createClient();
  const { data: pages } = await supabase
    .from('crawler_pages')
    .select(`
      *,
      crawler_sources(name)
    `)
    .order('last_crawled_at', { ascending: false })
    .limit(50);

  if (!pages || pages.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-slate-200 p-12 text-center">
        <p className="text-slate-600">No pages crawled yet</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">
                Page
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">
                Source
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">
                Last Crawled
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {pages.map((page: any) => (
              <tr key={page.id} className="hover:bg-slate-50">
                <td className="px-6 py-4">
                  <div className="max-w-md">
                    <p className="text-sm font-medium text-slate-900 truncate">
                      {page.title || 'Untitled'}
                    </p>
                    <a 
                      href={page.url} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-xs text-blue-600 hover:text-blue-700 truncate block mt-1"
                    >
                      {page.url}
                    </a>
                  </div>
                </td>
                <td className="px-6 py-4 text-sm text-slate-600">
                  {page.crawler_sources?.name || 'Unknown'}
                </td>
                <td className="px-6 py-4">
                  <span className={`px-2 py-1 text-xs font-medium rounded ${
                    page.crawl_status === 'success' ? 'bg-green-100 text-green-700' :
                    page.crawl_status === 'failed' ? 'bg-red-100 text-red-700' :
                    page.crawl_status === 'skipped' ? 'bg-yellow-100 text-yellow-700' :
                    'bg-slate-100 text-slate-600'
                  }`}>
                    {page.crawl_status}
                  </span>
                </td>
                <td className="px-6 py-4 text-sm text-slate-600">
                  {new Date(page.last_crawled_at).toLocaleString()}
                </td>
                <td className="px-6 py-4">
                  <button className="text-sm text-blue-600 hover:text-blue-700">
                    View Details
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
