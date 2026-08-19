-- Keep workspace integration seeding aligned with the provider names used by
-- the application. Older deployments seeded `gmail`, which is not a valid
-- provider in the current integrations contract and caused workspace inserts
-- to fail inside the AFTER INSERT trigger.

CREATE OR REPLACE FUNCTION public.seed_workspace_integrations()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.integrations (workspace_id, provider)
    VALUES
        (NEW.id, 'google_drive'),
        (NEW.id, 'notion'),
        (NEW.id, 'jira')
    ON CONFLICT (workspace_id, provider) DO NOTHING;

    RETURN NEW;
END;
$$;

-- Remove rows created by the legacy trigger before replacing the constraint.
DELETE FROM public.integrations
WHERE provider NOT IN ('google_drive', 'notion', 'jira');

ALTER TABLE public.integrations
DROP CONSTRAINT IF EXISTS integrations_provider_check;

ALTER TABLE public.integrations
ADD CONSTRAINT integrations_provider_check
CHECK (provider IN ('google_drive', 'notion', 'jira'));

-- Ensure existing workspaces have the complete current provider set.
INSERT INTO public.integrations (workspace_id, provider)
SELECT id, provider
FROM public.workspaces
CROSS JOIN (
    VALUES ('google_drive'), ('notion'), ('jira')
) AS providers(provider)
ON CONFLICT (workspace_id, provider) DO NOTHING;
