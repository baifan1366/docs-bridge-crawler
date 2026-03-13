import { Suspense } from 'react';
import Link from 'next/link';
import PagesTable from '@/components/admin/PagesTable';
import PagesFilters from '@/components/admin/PagesFilters';

export default function PagesMonitorPage() {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div>
              <Link href="/admin" className="text-sm text-blue-600 hover:text-blue-700 mb-2 inline-block">
                ← Back to Dashboard
              </Link>
              <h1 className="text-2xl font-bold text-slate-900">Pages Monitor</h1>
              <p className="text-sm text-slate-600 mt-1">Track crawled pages and their status</p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <PagesFilters />
        
        <Suspense fallback={<div className="text-center py-12">Loading pages...</div>}>
          <PagesTable />
        </Suspense>
      </main>
    </div>
  );
}
