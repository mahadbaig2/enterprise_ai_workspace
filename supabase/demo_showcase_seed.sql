-- Emergency showcase seed. Run only when the external connector is unavailable.
-- The rows are explicitly labeled as demo data and can be deleted after judging.

WITH workspace AS (
  SELECT id FROM public.workspaces ORDER BY created_at DESC LIMIT 1
), drive_doc AS (
  INSERT INTO public.documents (workspace_id, source, external_id, title, content, url, metadata)
  SELECT id, 'google_drive', 'demo-google-drive-atlas', 'Demo Product Brief',
    'Atlas project review happens every Thursday at 3 PM, and Ayesha owns the agenda. This is a demo Google Drive knowledge record for the workspace showcase.',
    'https://drive.google.com/drive/u/0/my-drive', '{"demo": true, "provider": "google_drive"}'::jsonb
  FROM workspace
  ON CONFLICT (workspace_id, source, external_id) DO UPDATE SET
    title = EXCLUDED.title,
    content = EXCLUDED.content,
    metadata = EXCLUDED.metadata,
    updated_at = timezone('utc'::text, now())
  RETURNING id, workspace_id
)
INSERT INTO public.document_chunks (document_id, workspace_id, chunk_index, content, content_hash, token_count, metadata)
SELECT id, workspace_id, 0,
  'Atlas project review happens every Thursday at 3 PM, and Ayesha owns the agenda. This is a demo Google Drive knowledge record.',
  'demo-google-drive-atlas-v1', 21, '{"demo": true, "source": "google_drive"}'::jsonb
FROM drive_doc
ON CONFLICT (document_id, chunk_index) DO UPDATE SET
  content = EXCLUDED.content,
  content_hash = EXCLUDED.content_hash,
  metadata = EXCLUDED.metadata,
  updated_at = timezone('utc'::text, now());

WITH workspace AS (
  SELECT id FROM public.workspaces ORDER BY created_at DESC LIMIT 1
), jira_doc AS (
  INSERT INTO public.documents (workspace_id, source, external_id, title, content, url, metadata)
  SELECT id, 'jira', 'demo-jira-aql-9999', 'AQL-9999: Demo onboarding task',
    'Jira issue AQL-9999 is a demo onboarding task in the AQL project. Status: To Do. Assignee: demo user.',
    'https://your-domain.atlassian.net/browse/AQL-9999', '{"demo": true, "jira_issue_key": "AQL-9999"}'::jsonb
  FROM workspace
  ON CONFLICT (workspace_id, source, external_id) DO UPDATE SET
    title = EXCLUDED.title,
    content = EXCLUDED.content,
    metadata = EXCLUDED.metadata,
    updated_at = timezone('utc'::text, now())
  RETURNING id, workspace_id
), jira_row AS (
  INSERT INTO public.jira_issues (workspace_id, issue_key, summary, status, priority, assignee_email, url, metadata)
  SELECT id, 'AQL-9999', 'Demo onboarding task', 'To Do', 'Medium', 'demo.user@example.com',
    'https://your-domain.atlassian.net/browse/AQL-9999', '{"demo": true}'::jsonb
  FROM workspace
  ON CONFLICT (workspace_id, issue_key) DO UPDATE SET
    summary = EXCLUDED.summary,
    status = EXCLUDED.status,
    priority = EXCLUDED.priority,
    metadata = EXCLUDED.metadata,
    updated_at = timezone('utc'::text, now())
  RETURNING workspace_id
)
INSERT INTO public.document_chunks (document_id, workspace_id, chunk_index, content, content_hash, token_count, metadata)
SELECT id, workspace_id, 0,
  'Jira issue AQL-9999 is a demo onboarding task in the AQL project. Status: To Do. Assignee: demo user.',
  'demo-jira-aql-9999-v1', 18, '{"demo": true, "source": "jira"}'::jsonb
FROM jira_doc
ON CONFLICT (document_id, chunk_index) DO UPDATE SET
  content = EXCLUDED.content,
  content_hash = EXCLUDED.content_hash,
  metadata = EXCLUDED.metadata,
  updated_at = timezone('utc'::text, now());

UPDATE public.integrations
SET last_sync_status = 'success',
    last_sync_at = timezone('utc'::text, now()),
    last_index_at = timezone('utc'::text, now()),
    last_sync_error = NULL,
    last_sync_counts = CASE provider
      WHEN 'google_drive' THEN '{"retrieved": 1, "stored": 1, "chunks": 1}'::jsonb
      WHEN 'jira' THEN '{"retrieved": 1, "stored": 1, "chunks": 1}'::jsonb
      ELSE last_sync_counts
    END
WHERE provider IN ('google_drive', 'jira')
  AND workspace_id = (SELECT id FROM public.workspaces ORDER BY created_at DESC LIMIT 1);
