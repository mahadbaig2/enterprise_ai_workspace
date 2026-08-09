import { generateGroqCompletion } from './groq';
import { createClient } from '../supabase/server';

export interface Citation {
  id: string;
  title: string;
  source: 'google_drive' | 'notion' | 'other';
  url?: string;
  snippet: string;
}

export interface KnowledgeAgentResponse {
  answer: string;
  citations: Citation[];
}

type KnowledgeDocument = {
  id?: string;
  document_id?: string;
  title: string;
  source: string;
  url?: string;
  content: string;
  chunk_index?: number;
};

function normalizeSource(source: string): Citation['source'] {
  if (source === 'google_drive' || source === 'notion') return source;
  return 'other';
}

export async function processKnowledgeQuery(
  userQuery: string,
  workspaceId?: string,
  authorization?: string
): Promise<KnowledgeAgentResponse> {
  let documents: KnowledgeDocument[] = [];

  try {
    if (authorization && workspaceId) {
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';
      const response = await fetch(backendUrl + '/rag/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authorization },
        body: JSON.stringify({ query: userQuery, match_count: 8 }),
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error('RAG search failed with status ' + response.status);
      }
      const rag = (await response.json()) as { results?: KnowledgeDocument[] };
      documents = rag.results || [];
    } else {
      const supabase = await createClient();
      const { data, error } = await supabase.rpc('match_document_chunks', {
        query_text: userQuery,
        query_embedding: null,
        match_threshold: 0.1,
        match_count: 8,
        filter_workspace_id: workspaceId || null,
        filter_sources: null,
        filter_metadata: null,
      });
      if (!error && data && data.length > 0) {
        documents = data as KnowledgeDocument[];
      }
    }
  } catch (err) {
    console.warn('RAG retrieval failed:', err);
  }

  const citations: Citation[] = documents.map((doc, idx) => ({
    id: doc.id || 'chunk-' + (idx + 1),
    title: doc.title,
    source: normalizeSource(doc.source),
    url: doc.url,
    snippet: doc.content.slice(0, 200) + (doc.content.length > 200 ? '...' : ''),
  }));

  const contextText = documents.length > 0
    ? documents
      .map((doc, idx) => '[Source ' + (idx + 1) + ': ' + doc.title + ' (' + doc.source + ')]\n' + doc.content)
      .join('\n\n')
    : 'No matching connected workspace documents were found.';

  const systemPrompt = 'You are the Knowledge Agent of Enterprise AI Workspace.\n' +
    'Answer the employee question strictly grounded in the provided document context.\n' +
    'Always cite sources inline using [Title] or [Source X] when context supports an answer.\n' +
    'If context does not contain the answer, state that information was not found in connected workspace documents.\n' +
    'Keep the response professional, concise, and structured in markdown.\n\n' +
    'DOCUMENT CONTEXT:\n' + contextText;

  const llmResponse = await generateGroqCompletion(systemPrompt, userQuery);
  const answer = llmResponse || (documents.length > 0
    ? 'I found ' + documents.length + ' relevant workspace document' +
      (documents.length === 1 ? '' : 's') +
      '. Review the citations below for the grounded source text.'
    : 'I could not find this information in the connected workspace documents.');

  return { answer, citations };
}
