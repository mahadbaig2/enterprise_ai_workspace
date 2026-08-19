-- Unified Workspace Brain: Jira RAG documents, sync/index metadata, and scoped memory.
-- Idempotent; run after phase7/phase8 (or after schema.sql).

-- Repair older deployments whose workspace trigger still inserted `gmail`.
CREATE OR REPLACE FUNCTION public.seed_workspace_integrations()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.integrations (workspace_id, provider)
  VALUES (NEW.id, 'google_drive'), (NEW.id, 'notion'), (NEW.id, 'jira')
  ON CONFLICT (workspace_id, provider) DO NOTHING;
  RETURN NEW;
END;
$$;
DELETE FROM public.integrations WHERE provider = 'gmail';
ALTER TABLE public.integrations DROP CONSTRAINT IF EXISTS integrations_provider_check;
ALTER TABLE public.integrations ADD CONSTRAINT integrations_provider_check
  CHECK (provider IN ('google_drive', 'notion', 'jira'));
DROP TRIGGER IF EXISTS seed_workspace_integrations_trigger ON public.workspaces;
CREATE TRIGGER seed_workspace_integrations_trigger AFTER INSERT ON public.workspaces
FOR EACH ROW EXECUTE FUNCTION public.seed_workspace_integrations();

ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS documents_source_check;
ALTER TABLE public.documents ADD CONSTRAINT documents_source_check
  CHECK (source IN ('google_drive', 'notion', 'jira'));

ALTER TABLE public.integrations
  ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS last_index_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS last_sync_status TEXT,
  ADD COLUMN IF NOT EXISTS last_sync_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS last_sync_error TEXT;

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS indexed_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS index_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS index_error TEXT;

ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS documents_index_status_check;
ALTER TABLE public.documents ADD CONSTRAINT documents_index_status_check
  CHECK (index_status IN ('pending', 'indexed', 'error'));

CREATE INDEX IF NOT EXISTS documents_workspace_source_updated_idx
  ON public.documents (workspace_id, source, updated_at DESC);
CREATE INDEX IF NOT EXISTS documents_workspace_index_status_idx
  ON public.documents (workspace_id, index_status, indexed_at DESC);

CREATE TABLE IF NOT EXISTS public.workspace_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  memory_key TEXT NOT NULL,
  memory_value TEXT NOT NULL,
  approved BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now()),
  UNIQUE (workspace_id, user_id, memory_key)
);

CREATE INDEX IF NOT EXISTS workspace_memory_scope_idx ON public.workspace_memory (workspace_id, user_id, approved);

ALTER TABLE public.workspace_memory ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can access scoped workspace memory" ON public.workspace_memory;
CREATE POLICY "Users can access scoped workspace memory" ON public.workspace_memory FOR ALL
  USING (user_id = (SELECT auth.uid()) AND workspace_id IN (SELECT id FROM public.workspaces WHERE owner_id = (SELECT auth.uid())))
  WITH CHECK (user_id = (SELECT auth.uid()) AND workspace_id IN (SELECT id FROM public.workspaces WHERE owner_id = (SELECT auth.uid())));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_memory TO authenticated;

-- Keep update timestamps correct for approved memory rows without requiring the API
-- to know about database-side mutation details.
CREATE OR REPLACE FUNCTION public.touch_workspace_memory_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS workspace_memory_updated_at ON public.workspace_memory;
CREATE TRIGGER workspace_memory_updated_at BEFORE UPDATE ON public.workspace_memory
FOR EACH ROW EXECUTE FUNCTION public.touch_workspace_memory_updated_at();
