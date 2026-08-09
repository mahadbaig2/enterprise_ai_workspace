-- Phase 6 Data Synchronization migration
-- Run this in the Supabase SQL Editor before calling POST /sync or POST /sync/{provider}.

-- Document upsert support for Google Drive and Notion sync.
ALTER TABLE public.documents
ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS documents_workspace_source_external_id_idx
ON public.documents (workspace_id, source, external_id);

-- Sync run audit table.
CREATE TABLE IF NOT EXISTS public.sync_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running',
    retrieved_count INTEGER NOT NULL DEFAULT 0,
    stored_count INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    completed_at TIMESTAMP WITH TIME ZONE
);

ALTER TABLE public.sync_runs
DROP CONSTRAINT IF EXISTS sync_runs_provider_check;

ALTER TABLE public.sync_runs
ADD CONSTRAINT sync_runs_provider_check
CHECK (provider IN ('google_drive', 'notion', 'jira'));

ALTER TABLE public.sync_runs
DROP CONSTRAINT IF EXISTS sync_runs_status_check;

ALTER TABLE public.sync_runs
ADD CONSTRAINT sync_runs_status_check
CHECK (status IN ('running', 'success', 'error'));

CREATE INDEX IF NOT EXISTS sync_runs_workspace_started_at_idx
ON public.sync_runs (workspace_id, started_at DESC);

-- Jira issue metadata table.
CREATE TABLE IF NOT EXISTS public.jira_issues (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    issue_key TEXT NOT NULL,
    summary TEXT NOT NULL,
    status TEXT,
    priority TEXT,
    assignee_email TEXT,
    url TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(workspace_id, issue_key)
);

CREATE INDEX IF NOT EXISTS jira_issues_workspace_status_idx
ON public.jira_issues (workspace_id, status);

-- RLS enablement.
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jira_issues ENABLE ROW LEVEL SECURITY;

-- RLS policies. auth.uid() is wrapped in SELECT for Supabase RLS performance.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'documents'
          AND policyname = 'Users can access documents for owned workspace'
    ) THEN
        CREATE POLICY "Users can access documents for owned workspace"
        ON public.documents
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

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'sync_runs'
          AND policyname = 'Users can access sync runs for owned workspace'
    ) THEN
        CREATE POLICY "Users can access sync runs for owned workspace"
        ON public.sync_runs
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

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'jira_issues'
          AND policyname = 'Users can access jira issues for owned workspace'
    ) THEN
        CREATE POLICY "Users can access jira issues for owned workspace"
        ON public.jira_issues
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
