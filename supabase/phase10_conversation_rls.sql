-- Conversation RLS repair.
-- RLS was enabled for conversations/messages without INSERT policies, causing
-- authenticated conversation creation to fail with a policy violation.

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can access own workspace conversations" ON public.conversations;
CREATE POLICY "Users can access own workspace conversations"
ON public.conversations
FOR ALL
USING (
  user_id = (SELECT auth.uid())
  AND workspace_id IN (
    SELECT id FROM public.workspaces WHERE owner_id = (SELECT auth.uid())
  )
)
WITH CHECK (
  user_id = (SELECT auth.uid())
  AND workspace_id IN (
    SELECT id FROM public.workspaces WHERE owner_id = (SELECT auth.uid())
  )
);

DROP POLICY IF EXISTS "Users can access messages in own conversations" ON public.messages;
CREATE POLICY "Users can access messages in own conversations"
ON public.messages
FOR ALL
USING (
  conversation_id IN (
    SELECT id FROM public.conversations
    WHERE user_id = (SELECT auth.uid())
  )
)
WITH CHECK (
  conversation_id IN (
    SELECT id FROM public.conversations
    WHERE user_id = (SELECT auth.uid())
  )
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages TO authenticated;
