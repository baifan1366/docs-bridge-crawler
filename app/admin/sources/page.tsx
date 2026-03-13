import { Suspense } from 'react';
import Link from 'next/link';
import SourcesList from '@/components/admin/SourcesList';
import AddSourceButton from '@/components/admin/AddSourceButton';

export default function SourcesPage() {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div>
              <Link href="/admin" className="text-sm text-blue-600 hover:text-blue-700 mb-2 inline-block">
                ← Back to Dashboard
              </Link>
              <h1 className="text-2xl font-bold text-slate-900">Crawler Sources</h1>
              <p className="text-sm text-slate-600 mt-1">Manage websites to crawl</p>
            </div>
            <AddSourceButton />
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Suspense fallback={<div className="text-center py-12">Loading sources...</div>}>
          <SourcesList />
        </Suspense>
      </main>
    </div>
  );
}
