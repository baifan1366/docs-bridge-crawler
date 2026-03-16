'use client';

import { useState, useEffect } from 'react';

interface Document {
  id: string;
  title: string;
  content_hash: string | null;
  updated_at: string;
  embeddings_updated_at: string | null;
  document_chunks: string[] | null;
  needs_update: boolean;
  chunk_count: number;
}

interface EmbeddingStats {
  processed: number;
  updated: number;
  errors: number;
  chunks_created: number;
  chunks_updated: number;
  chunks_removed: number;
}

export default function EmbeddingsStatus() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const [stats, setStats] = useState<{ total: number; needs_update: number } | null>(null);

  const fetchStatus = async () => {
    try {
      const response = await fetch('/api/admin/embeddings');
      const data = await response.json();
      setDocuments(data.documents || []);
      setStats({ total: data.total, needs_update: data.needs_update });
    } catch (error) {
      console.error('Error fetching embedding status:', error);
    } finally {
      setLoading(false);
    }
  };

  const updateDocument = async (documentId: string, force = false) => {
    setUpdating(documentId);
    try {
      const response = await fetch(
        `/api/admin/embeddings?document_id=${documentId}${force ? '&force=true' : ''}`,
        { method: 'POST' }
      );
      const data = await response.json();
      
      if (response.ok) {
        console.log('Update successful:', data.stats);
        await fetchStatus(); // Refresh the list
      } else {
        console.error('Update failed:', data.error);
      }
    } catch (error) {
      console.error('Error updating document:', error);
    } finally {
      setUpdating(null);
    }
  };

  const updateAll = async () => {
    setUpdating('all');
    try {
      const response = await fetch('/api/admin/embeddings', { method: 'POST' });
      const data = await response.json();
      
      if (response.ok) {
        console.log('Batch update successful:', data.stats);
        await fetchStatus(); // Refresh the list
      } else {
        console.error('Batch update failed:', data.error);
      }
    } catch (error) {
      console.error('Error updating all documents:', error);
    } finally {
      setUpdating(null);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  if (loading) {
    return <div className="p-4">Loading embedding status...</div>;
  }

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold">Document Embeddings</h2>
          <p className="text-sm text-gray-600 mt-1">
            Auto-update runs daily at 2 AM (Vercel Hobby plan limitation)
          </p>
        </div>
        <button
          onClick={updateAll}
          disabled={updating === 'all'}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {updating === 'all' ? 'Updating All...' : 'Update All'}
        </button>
      </div>

      {stats && (
        <>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="bg-gray-100 p-4 rounded">
              <h3 className="font-semibold">Total Documents</h3>
              <p className="text-2xl">{stats.total}</p>
            </div>
            <div className="bg-yellow-100 p-4 rounded">
              <h3 className="font-semibold">Need Updates</h3>
              <p className="text-2xl">{stats.needs_update}</p>
            </div>
          </div>
          
          <div className="bg-blue-50 border border-blue-200 rounded p-4 mb-6">
            <div className="flex items-start">
              <div className="shrink-0">
                <svg className="h-5 w-5 text-blue-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-blue-800">Vercel Hobby Plan Limitations</h3>
                <div className="mt-2 text-sm text-blue-700">
                  <p>• Automatic updates run once daily (2 AM ±59 min)</p>
                  <p>• Use manual updates for immediate processing</p>
                  <p>• Upgrade to Pro for more frequent updates</p>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      <div className="space-y-4">
        {documents.map((doc) => (
          <div key={doc.id} className="border rounded p-4">
            <div className="flex justify-between items-start">
              <div className="flex-1">
                <h3 className="font-semibold">{doc.title}</h3>
                <div className="text-sm text-gray-600 mt-1">
                  <p>Chunks: {doc.chunk_count}</p>
                  <p>Updated: {doc.updated_at ? new Date(doc.updated_at).toLocaleString() : 'Never'}</p>
                  <p>Embeddings: {doc.embeddings_updated_at ? new Date(doc.embeddings_updated_at).toLocaleString() : 'Never'}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`px-2 py-1 rounded text-xs ${
                  doc.needs_update ? 'bg-yellow-200 text-yellow-800' : 'bg-green-200 text-green-800'
                }`}>
                  {doc.needs_update ? 'Needs Update' : 'Up to Date'}
                </span>
                <button
                  onClick={() => updateDocument(doc.id, false)}
                  disabled={updating === doc.id}
                  className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
                >
                  {updating === doc.id ? 'Updating...' : 'Update'}
                </button>
                <button
                  onClick={() => updateDocument(doc.id, true)}
                  disabled={updating === doc.id}
                  className="px-3 py-1 bg-orange-600 text-white rounded text-sm hover:bg-orange-700 disabled:opacity-50"
                >
                  Force
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {documents.length === 0 && (
        <div className="text-center py-8 text-gray-500">
          No documents found
        </div>
      )}
    </div>
  );
}