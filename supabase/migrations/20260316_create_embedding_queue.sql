-- Create embedding queue table for async processing
CREATE TABLE IF NOT EXISTS public.embedding_queue (
  id TEXT PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES public.kb_documents(id) ON DELETE CASCADE,
  chunk_id UUID NOT NULL REFERENCES public.document_chunks(id) ON DELETE CASCADE,
  chunk_text TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('high', 'normal', 'low')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  error_message TEXT,
  processed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_embedding_queue_status ON public.embedding_queue(status);
CREATE INDEX IF NOT EXISTS idx_embedding_queue_document_id ON public.embedding_queue(document_id);
CREATE INDEX IF NOT EXISTS idx_embedding_queue_priority_created ON public.embedding_queue(priority DESC, created_at ASC) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_embedding_queue_processed_at ON public.embedding_queue(processed_at) WHERE status = 'completed';

-- Updated timestamp trigger
DROP TRIGGER IF EXISTS update_embedding_queue_updated_at ON public.embedding_queue;
CREATE TRIGGER update_embedding_queue_updated_at
  BEFORE UPDATE ON public.embedding_queue
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- RLS policies
CREATE POLICY "Service role can access embedding queue"
  ON public.embedding_queue FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Authenticated users can read embedding queue"
  ON public.embedding_queue FOR SELECT
  USING (auth.role() = 'authenticated');

-- Comments
COMMENT ON TABLE public.embedding_queue IS 'Queue for async embedding generation jobs';
COMMENT ON COLUMN public.embedding_queue.priority IS 'Job priority: high, normal, or low';
COMMENT ON COLUMN public.embedding_queue.status IS 'Job status: pending, processing, completed, or failed';
COMMENT ON COLUMN public.embedding_queue.attempts IS 'Number of processing attempts';
COMMENT ON COLUMN public.embedding_queue.chunk_text IS 'Text content to generate embeddings for';

-- Function to get queue statistics
CREATE OR REPLACE FUNCTION get_embedding_queue_stats()
RETURNS TABLE (
  status TEXT,
  count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    eq.status,
    COUNT(*) as count
  FROM embedding_queue eq
  WHERE eq.status != 'completed' OR eq.processed_at > NOW() - INTERVAL '1 day'
  GROUP BY eq.status
  ORDER BY eq.status;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to cleanup old completed jobs
CREATE OR REPLACE FUNCTION cleanup_embedding_queue(older_than_days INTEGER DEFAULT 7)
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM embedding_queue 
  WHERE status = 'completed' 
    AND processed_at < NOW() - (older_than_days || ' days')::INTERVAL;
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_embedding_queue_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION cleanup_embedding_queue(INTEGER) TO service_role;