# MVP RAG rescue patch

Apply these changes on a branch created from the current working version:

```bash
git switch -c mvp-rag-rescue
```

## What was fixed

- Groq errors are no longer silently converted to `null` responses.
- Intent routing falls back safely when Groq is unavailable.
- Retrieved chunks are validated and deduplicated before prompt construction.
- The prompt explicitly requires a synthesized answer rather than a list of links.
- If generation fails, the chat displays the most relevant source passages instead of citation cards alone.
- Direct Supabase retrieval now runs when the backend RAG request fails, not only when it returns an empty result.
- Prompt context is capped to avoid oversized generation requests.

## Deployment checklist

1. Set `GROQ_API_KEY` and `GROQ_MODEL` in the frontend deployment environment. A local `.env.local` is not uploaded automatically by most hosts.
2. Set `NEXT_PUBLIC_BACKEND_URL` to the deployed FastAPI base URL.
3. Redeploy the frontend after changing environment variables.
4. Resync and reindex Notion documents once.
5. Ask a question whose exact answer is known to exist in a Notion page.
6. Confirm that the response contains a direct answer with `[Source X]` references and that source cards appear below it.

## Safe demo test

Create a Notion page containing a unique statement such as:

> The Atlas project review happens every Thursday at 3 PM, and Ayesha owns the agenda.

After syncing and indexing, ask:

> When is the Atlas project review and who owns the agenda?

The answer should state both facts and cite the indexed page. This avoids ambiguity while verifying the complete ingestion, retrieval, generation, and citation path.
