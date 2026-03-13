import { Suspense } from 'react';
import Link from 'next/link';
import DashboardStats from '@/components/admin/DashboardStats';
import RecentActivity from '@/components/admin/RecentActivity';
import SourcesOverview from '@/components/admin/SourcesOverview';

export default function AdminDashboard() {
  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Crawler Admin</h1>
              <p className="text-sm text-slate-600 mt-1">Monitor and manage your crawling operations</p>
            </div>
            <nav className="flex gap-4">
              <Link href="/admin" className="px-4 py-2 text-sm font-medium text-slate-900 bg-slate-100 rounded-lg">
                Dashboard
              </Link>
              <Link href="/admin/sources" className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors">
                Sources
              </Link>
              <Link href="/admin/pages" className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors">
                Pages
              </Link>
              <Link href="/admin/metrics" className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors">
                Metrics
              </Link>
            </nav>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Suspense fallback={<div>Loading stats...</div>}>
          <DashboardStats />
        </Suspense>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-8">
          <Suspense fallback={<div>Loading sources...</div>}>
            <SourcesOverview />
          </Suspense>
          
          <Suspense fallback={<div>Loading activity...</div>}>
            <RecentActivity />
          </Suspense>
        </div>
      </main>
    </div>
  );
}
