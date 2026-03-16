/**
 * Admin API for managing document embeddings
 * POST /api/admin/embeddings - Update embeddings for all documents
 * POST /api/admin/embeddings?document_id=xxx - Update embeddings for specific document
 */

import { NextRequest, NextResponse } from 'next/server';
import { updateDocumentEmbeddings, updateAllDocumentEmbeddings, forceUpdateDocumentEmbeddings } from '@/lib/embeddings/document-updater';

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    const { searchParams } = new URL(request.url);
    const documentId = searchParams.get('document_id');
    const force = searchParams.get('force') === 'true';

    let stats;
    
    if (documentId) {
      console.log(`[ADMIN-EMBEDDINGS] Updating embeddings for document: ${documentId}`);
      
      if (force) {
        stats = await forceUpdateDocumentEmbeddings(documentId);
      } else {
        stats = await updateDocumentEmbeddings(documentId);
      }
    } else {
      console.log('[ADMIN-EMBEDDINGS] Updating embeddings for all documents');
      stats = await updateAllDocumentEmbeddings();
    }

    const duration = Date.now() - startTime;
    console.log(`[ADMIN-EMBEDDINGS] Completed in ${duration}ms`);

    return NextResponse.json({
      message: documentId 
        ? `Embeddings updated for document ${documentId}` 
        : 'Embeddings updated for all documents',
      stats,
      duration_ms: duration,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    const duration = Date.now() - startTime;
    console.error('[ADMIN-EMBEDDINGS] Error:', error);
    
    return NextResponse.json(
      { 
        error: error instanceof Error ? error.message : 'Unexpected error',
        duration_ms: duration,
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const documentId = searchParams.get('document_id');

    // Get embedding status for documents
    const supabase = await (await import('@/lib/supabase/server')).createClient();
    
    let query = supabase
      .from('kb_documents')
      .select(`
        id,
        title,
        content_hash,
        updated_at,
        embeddings_updated_at,
        document_chunks
      `);

    if (documentId) {
      query = query.eq('id', documentId);
    }

    const { data: documents, error } = await query.limit(50);

    if (error) throw error;

    // Check which documents need updates
    const documentsWithStatus = documents?.map(doc => ({
      ...doc,
      needs_update: !doc.embeddings_updated_at || 
                   (doc.updated_at && new Date(doc.updated_at) > new Date(doc.embeddings_updated_at || 0)),
      chunk_count: doc.document_chunks?.length || 0
    })) || [];

    return NextResponse.json({
      documents: documentsWithStatus,
      total: documentsWithStatus.length,
      needs_update: documentsWithStatus.filter(d => d.needs_update).length
    });

  } catch (error: any) {
    console.error('[ADMIN-EMBEDDINGS] Error getting status:', error);
    
    return NextResponse.json(
      { 
        error: error instanceof Error ? error.message : 'Unexpected error'
      },
      { status: 500 }
    );
  }
}