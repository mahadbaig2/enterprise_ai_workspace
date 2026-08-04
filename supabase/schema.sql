-- Enable pgvector extension for semantic search
CREATE EXTENSION IF NOT EXISTS vector;

-- 1. PROFILES TABLE (Tied to Supabase auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    full_name TEXT,
    avatar_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. WORKSPACES TABLE
CREATE TABLE IF NOT EXISTS public.workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    company_name TEXT NOT NULL,
    owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. WORKSPACE MEMBERS TABLE
CREATE TABLE IF NOT EXISTS public.workspace_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member', -- 'owner', 'admin', 'member'
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(workspace_id, user_id)
);

-- 4. ONBOARDING TABLE
CREATE TABLE IF NOT EXISTS public.onboarding (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    current_step INTEGER NOT NULL DEFAULT 1,
    completed BOOLEAN NOT NULL DEFAULT FALSE,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(workspace_id)
);

CREATE OR REPLACE FUNCTION public.create_workspace_onboarding()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.onboarding (workspace_id)
    VALUES (NEW.id)
    ON CONFLICT (workspace_id) DO NOTHING;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS create_workspace_onboarding_trigger ON public.workspaces;
CREATE TRIGGER create_workspace_onboarding_trigger
AFTER INSERT ON public.workspaces
FOR EACH ROW
EXECUTE FUNCTION public.create_workspace_onboarding();

INSERT INTO public.onboarding (workspace_id)
SELECT id
FROM public.workspaces
ON CONFLICT (workspace_id) DO NOTHING;

-- 5. INTEGRATIONS TABLE
CREATE TABLE IF NOT EXISTS public.integrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    provider TEXT NOT NULL, -- 'google_drive', 'notion', 'jira'
    connection_id TEXT,
    status TEXT NOT NULL DEFAULT 'disconnected', -- 'connected', 'disconnected', 'error'
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(workspace_id, provider)
);

-- 6. DOCUMENTS TABLE (Hybrid Search: pgvector + Full-Text Search)
CREATE TABLE IF NOT EXISTS public.documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    source TEXT NOT NULL, -- 'google_drive', 'notion'
    external_id TEXT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    url TEXT,
    embedding VECTOR(1536), -- Supports 1536d embeddings (OpenAI / standard embeddings)
    fts TSVECTOR GENERATED ALWAYS AS (
        to_tsvector('english', coalesce(title, '') || ' ' || coalesce(content, ''))
    ) STORED,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Index for Vector Search (HNSW)
CREATE INDEX IF NOT EXISTS documents_embedding_idx 
ON public.documents 
USING hnsw (embedding vector_cosine_ops);

-- Index for Full-Text Search (GIN)
CREATE INDEX IF NOT EXISTS documents_fts_idx 
ON public.documents 
USING gin (fts);

-- 7. CONVERSATIONS TABLE
CREATE TABLE IF NOT EXISTS public.conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT 'New Conversation',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 8. MESSAGES TABLE
CREATE TABLE IF NOT EXISTS public.messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    sender TEXT NOT NULL, -- 'user', 'agent'
    agent_type TEXT, -- 'workflow', 'knowledge', 'task'
    content TEXT NOT NULL,
    citations JSONB DEFAULT '[]'::jsonb,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 9. HYBRID SEARCH STORED FUNCTION (Semantic Vector + FTS Keyword Match)
CREATE OR REPLACE FUNCTION match_documents(
    query_text TEXT,
    query_embedding VECTOR(1536),
    match_threshold FLOAT DEFAULT 0.2,
    match_count INT DEFAULT 10,
    filter_workspace_id UUID DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    workspace_id UUID,
    source TEXT,
    title TEXT,
    content TEXT,
    url TEXT,
    similarity FLOAT,
    fts_rank FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        d.id,
        d.workspace_id,
        d.source,
        d.title,
        d.content,
        d.url,
        COALESCE(1 - (d.embedding <=> query_embedding), 0.0)::FLOAT AS similarity,
        COALESCE(ts_rank_cd(d.fts, websearch_to_tsquery('english', query_text)), 0.0)::FLOAT AS fts_rank
    FROM public.documents d
    WHERE 
        (filter_workspace_id IS NULL OR d.workspace_id = filter_workspace_id)
        AND (
            (query_embedding IS NOT NULL AND 1 - (d.embedding <=> query_embedding) > match_threshold)
            OR (query_text IS NOT NULL AND d.fts @@ websearch_to_tsquery('english', query_text))
        )
    ORDER BY (
        COALESCE(1 - (d.embedding <=> query_embedding), 0.0) * 0.7 + 
        COALESCE(ts_rank_cd(d.fts, websearch_to_tsquery('english', query_text)), 0.0) * 0.3
    ) DESC
    LIMIT match_count;
END;
$$;

-- Enable Row Level Security (RLS)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- Basic RLS Policies (Allow access for workspace members / authenticated users)
CREATE POLICY "Users can access own profile" ON public.profiles FOR ALL USING (auth.uid() = id);
CREATE POLICY "Users can access workspaces they belong to" ON public.workspaces FOR ALL USING (
    id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()) OR owner_id = auth.uid()
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'onboarding'
          AND policyname = 'Users can access onboarding for owned workspace'
    ) THEN
        CREATE POLICY "Users can access onboarding for owned workspace"
        ON public.onboarding
        FOR ALL
        USING (
            workspace_id IN (
                SELECT id
                FROM public.workspaces
                WHERE owner_id = (SELECT auth.uid())
            )
        )
        WITH CHECK (
            workspace_id IN (
                SELECT id
                FROM public.workspaces
                WHERE owner_id = (SELECT auth.uid())
            )
        );
    END IF;
END $$;
