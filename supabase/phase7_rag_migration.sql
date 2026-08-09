-- Phase 7 RAG migration
-- Run this file in the Supabase SQL Editor after the Phase 6 migration.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS public.document_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    token_count INTEGER NOT NULL DEFAULT 0,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    embedding VECTOR(1536),
    fts TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', coalesce(content, ''))) STORED,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now()),
    UNIQUE(document_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS document_chunks_workspace_document_idx
ON public.document_chunks (workspace_id, document_id, chunk_index);

CREATE INDEX IF NOT EXISTS document_chunks_fts_idx
ON public.document_chunks USING gin (fts);

CREATE INDEX IF NOT EXISTS document_chunks_embedding_idx
ON public.document_chunks USING hnsw (embedding vector_cosine_ops)
WHERE embedding IS NOT NULL;

CREATE INDEX IF NOT EXISTS document_chunks_metadata_idx
ON public.document_chunks USING gin (metadata);

ALTER TABLE public.document_chunks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can access document chunks for owned workspace"
ON public.document_chunks;

CREATE POLICY "Users can access document chunks for owned workspace"
ON public.document_chunks
FOR ALL
USING (
    workspace_id IN (
        SELECT id FROM public.workspaces WHERE owner_id = (SELECT auth.uid())
    )
)
WITH CHECK (
    workspace_id IN (
        SELECT id FROM public.workspaces WHERE owner_id = (SELECT auth.uid())
    )
);

CREATE OR REPLACE FUNCTION public.match_document_chunks(
    query_text TEXT,
    query_embedding VECTOR(1536),
    match_threshold FLOAT DEFAULT 0.15,
    match_count INT DEFAULT 8,
    filter_workspace_id UUID DEFAULT NULL,
    filter_sources TEXT[] DEFAULT NULL,
    filter_metadata JSONB DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    document_id UUID,
    workspace_id UUID,
    source TEXT,
    title TEXT,
    content TEXT,
    url TEXT,
    chunk_index INTEGER,
    similarity FLOAT,
    fts_rank FLOAT,
    metadata JSONB
)
LANGUAGE sql
STABLE
AS $$
    SELECT
        c.id, c.document_id, c.workspace_id, d.source, d.title, c.content, d.url,
        c.chunk_index,
        COALESCE(1 - (c.embedding <=> query_embedding), 0.0)::FLOAT,
        COALESCE(ts_rank_cd(c.fts, websearch_to_tsquery('english', coalesce(query_text, ''))), 0.0)::FLOAT,
        d.metadata || c.metadata
    FROM public.document_chunks AS c
    JOIN public.documents AS d ON d.id = c.document_id
    WHERE filter_workspace_id IS NOT NULL
      AND c.workspace_id = filter_workspace_id
      AND (filter_sources IS NULL OR d.source = ANY(filter_sources))
      AND (filter_metadata IS NULL OR d.metadata @> filter_metadata OR c.metadata @> filter_metadata)
      AND (
          (query_embedding IS NOT NULL AND c.embedding IS NOT NULL
           AND 1 - (c.embedding <=> query_embedding) > match_threshold)
          OR (query_text IS NOT NULL AND c.fts @@ websearch_to_tsquery('english', query_text))
      )
    ORDER BY (
        COALESCE(1 - (c.embedding <=> query_embedding), 0.0) * 0.7
        + COALESCE(ts_rank_cd(c.fts, websearch_to_tsquery('english', coalesce(query_text, ''))), 0.0) * 0.3
    ) DESC, c.chunk_index ASC
    LIMIT LEAST(GREATEST(match_count, 1), 50);
$$;

GRANT EXECUTE ON FUNCTION public.match_document_chunks(TEXT, VECTOR(1536), FLOAT, INT, UUID, TEXT[], JSONB)
TO authenticated, service_role;
