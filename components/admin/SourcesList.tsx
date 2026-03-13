import { createClient } from '@/lib/supabase/server';

export default async function SourcesList() {
  const supabase = await createClient();
  const { data: sources } = await supabase
    .from('crawler_sources')
    .select(`
      *,
      crawler_pages(count)
    `)
    .order('created_at', { ascending: false });

  if (!sources || sources.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-slate-200 p-12 text-center">
        <p className="text-slate-600 mb-4">No crawler sources configured yet</p>
        <p className="text-sm text-slate-500">Add your first source to start crawling</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {sources.map((source: any) => (
        <div key={source.id} className="bg-white rounded-lg border border-slate-200 p-6">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <h3 className="text-lg font-semibold text-slate-900">{source.name}</h3>
                <span className={`px-3 py-1 text-xs font-medium rounded-full ${
                  source.is_active 
                    ? 'bg-green-100 text-green-700' 
                    : 'bg-slate-100 text-slate-600'
                }`}>
                  {source.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
              
              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <p className="text-sm font-medium text-slate-600">Base URL</p>
                  <a 
                    href={source.base_url} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-sm text-blue-600 hover:text-blue-700 mt-1 inline-block"
                  >
                    {source.base_url}
                  </a>
                </div>
                
                {source.sitemap_url && (
                  <div>
                    <p className="text-sm font-medium text-slate-600">Sitemap URL</p>
                    <a 
                      href={source.sitemap_url} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-sm text-blue-600 hover:text-blue-700 mt-1 inline-block"
                    >
                      {source.sitemap_url}
                    </a>
                  </div>
                )}
              </div>

              <div className="mt-4 flex items-center gap-6 text-sm">
                <div>
                  <span className="text-slate-600">Pages Crawled:</span>
                  <span className="ml-2 font-medium text-slate-900">
                    {source.crawler_pages?.[0]?.count || 0}
                  </span>
                </div>
                <div>
                  <span className="text-slate-600">Trust Level:</span>
                  <span className="ml-2 font-medium text-slate-900">
                    {source.metadata?.trust_level || 1.0}
                  </span>
                </div>
                <div>
                  <span className="text-slate-600">Created:</span>
                  <span className="ml-2 font-medium text-slate-900">
                    {new Date(source.created_at).toLocaleDateString()}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex gap-2 ml-4">
              <button className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors">
                Edit
              </button>
              <button className="px-4 py-2 text-sm font-medium text-blue-700 bg-blue-100 hover:bg-blue-200 rounded-lg transition-colors">
                Trigger Crawl
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
