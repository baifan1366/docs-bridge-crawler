import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';

export default async function SourcesOverview() {
  const supabase = await createClient();
  const { data: sources } = await supabase
    .from('crawler_sources')
    .select(`
      *,
      crawler_pages(count)
    `)
    .order('created_at', { ascending: false })
    .limit(5);

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-slate-900">Crawler Sources</h2>
        <Link 
          href="/admin/sources" 
          className="text-sm font-medium text-blue-600 hover:text-blue-700"
        >
          View all →
        </Link>
      </div>

      <div className="space-y-4">
        {sources && sources.length > 0 ? (
          sources.map((source: any) => (
            <div key={source.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
              <div className="flex-1">
                <h3 className="font-medium text-slate-900">{source.name}</h3>
                <p className="text-sm text-slate-600 mt-1">{source.base_url}</p>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <p className="text-sm font-medium text-slate-900">
                    {source.crawler_pages?.[0]?.count || 0} pages
                  </p>
                  <p className="text-xs text-slate-600">crawled</p>
                </div>
                <span className={`px-3 py-1 text-xs font-medium rounded-full ${
                  source.is_active 
                    ? 'bg-green-100 text-green-700' 
                    : 'bg-slate-100 text-slate-600'
                }`}>
                  {source.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
            </div>
          ))
        ) : (
          <p className="text-center text-slate-600 py-8">No sources configured yet</p>
        )}
      </div>
    </div>
  );
}
