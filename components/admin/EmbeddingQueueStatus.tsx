'use client';

import { useState, useEffect } from 'react';

interface QueueStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  total: number;
}

export default function EmbeddingQueueStatus() {
  const [stats, setStats] = useState<QueueStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);

  const fetchStats = async () => {
    try {
      const response = await fetch('/api/queue/embeddings?action=stats');
      const data = await response.json();
      if (data.success) {
        setStats(data.stats);
      }
    } catch (error) {
      console.error('Error fetching queue stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const processQueue = async (batchSize: number = 5) => {
    setProcessing(true);
    try {
      const response = await fetch(`/api/queue/embeddings?batch_size=${batchSize}`, {
        method: 'POST'
      });
      const data = await response.json();
      
      if (data.success) {
        console.log('Queue processing result:', data);
        await fetchStats(); // Refresh stats
      } else {
        console.error('Queue processing failed:', data.error);
      }
    } catch (error) {
      console.error('Error processing queue:', error);
    } finally {
      setProcessing(false);
    }
  };

  const cleanupQueue = async (days: number = 7) => {
    try {
      const response = await fetch(`/api/queue/embeddings?action=cleanup&days=${days}`);
      const data = await response.json();
      
      if (data.success) {
        console.log('Cleanup result:', data.message);
        await fetchStats(); // Refresh stats
      }
    } catch (error) {
      console.error('Error cleaning up queue:', error);
    }
  };

  useEffect(() => {
    fetchStats();
    
    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return <div className="p-4">Loading queue status...</div>;
  }

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold">Embedding Queue</h2>
          <p className="text-sm text-gray-600 mt-1">
            Async processing queue for document embeddings
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => processQueue(5)}
            disabled={processing}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {processing ? 'Processing...' : 'Process Queue'}
          </button>
          <button
            onClick={() => cleanupQueue(7)}
            className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
          >
            Cleanup Old Jobs
          </button>
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          <div className="bg-yellow-100 p-4 rounded">
            <h3 className="font-semibold text-yellow-800">Pending</h3>
            <p className="text-2xl text-yellow-900">{stats.pending}</p>
          </div>
          <div className="bg-blue-100 p-4 rounded">
            <h3 className="font-semibold text-blue-800">Processing</h3>
            <p className="text-2xl text-blue-900">{stats.processing}</p>
          </div>
          <div className="bg-green-100 p-4 rounded">
            <h3 className="font-semibold text-green-800">Completed</h3>
            <p className="text-2xl text-green-900">{stats.completed}</p>
          </div>
          <div className="bg-red-100 p-4 rounded">
            <h3 className="font-semibold text-red-800">Failed</h3>
            <p className="text-2xl text-red-900">{stats.failed}</p>
          </div>
          <div className="bg-gray-100 p-4 rounded">
            <h3 className="font-semibold text-gray-800">Total</h3>
            <p className="text-2xl text-gray-900">{stats.total}</p>
          </div>
        </div>
      )}

      <div className="bg-blue-50 border border-blue-200 rounded p-4 mb-6">
        <div className="flex items-start">
          <div className="shrink-0">
            <svg className="h-5 w-5 text-blue-400" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="ml-3">
            <h3 className="text-sm font-medium text-blue-800">Async Processing</h3>
            <div className="mt-2 text-sm text-blue-700">
              <p>• Embeddings are generated in the background</p>
              <p>• Queue processes automatically every 4 hours</p>
              <p>• Manual processing available for immediate needs</p>
              <p>• Failed jobs are retried up to 3 times</p>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white border rounded p-4">
        <h3 className="font-semibold mb-3">Queue Processing Options</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <button
            onClick={() => processQueue(1)}
            disabled={processing}
            className="p-3 border rounded hover:bg-gray-50 disabled:opacity-50"
          >
            <div className="font-medium">Small Batch</div>
            <div className="text-sm text-gray-600">Process 1 job</div>
          </button>
          <button
            onClick={() => processQueue(5)}
            disabled={processing}
            className="p-3 border rounded hover:bg-gray-50 disabled:opacity-50"
          >
            <div className="font-medium">Medium Batch</div>
            <div className="text-sm text-gray-600">Process 5 jobs</div>
          </button>
          <button
            onClick={() => processQueue(20)}
            disabled={processing}
            className="p-3 border rounded hover:bg-gray-50 disabled:opacity-50"
          >
            <div className="font-medium">Large Batch</div>
            <div className="text-sm text-gray-600">Process 20 jobs</div>
          </button>
        </div>
      </div>

      {stats && stats.total === 0 && (
        <div className="text-center py-8 text-gray-500">
          <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <h3 className="mt-2 text-sm font-medium text-gray-900">No jobs in queue</h3>
          <p className="mt-1 text-sm text-gray-500">All embedding jobs have been processed</p>
        </div>
      )}
    </div>
  );
}