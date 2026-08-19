import { generateGroqCompletion } from './groq';
import { createClient } from '../supabase/server';

export interface Citation {
  id: string;
  title: string;
  source: 'google_drive' | 'notion' | 'jira' | 'other';
  url?: string;
  snippet: string;
}

export interface KnowledgeAgentResponse {
  answer: string;
  citations: Citation[];
  retrievalStatus: 'ok' | 'no_evidence' | 'retrieval_failure' | 'llm_failure';
  error?: string;
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

const MAX_CONTEXT_CHARACTERS = 18_000;

function usableDocuments(documents: KnowledgeDocument[]): KnowledgeDocument[] {
  const seen = new Set<string>();
  return documents.filter((doc) => {
    const content = doc.content?.trim();
    if (!content) return false;
    const key = `${doc.document_id || doc.id || doc.title}:${doc.chunk_index ?? content.slice(0, 80)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildExtractiveFallback(documents: KnowledgeDocument[]): string {
  const passages = documents.slice(0, 3).map((doc, index) => {
    const content = doc.content.trim();
    const excerpt = content.replace(/\s+/g, ' ').slice(0, 700);
    return `${index + 1}. **${doc.title || 'Untitled document'}:** ${excerpt}${content.length > 700 ? '...' : ''} [Source ${index + 1}]`;
  });

  return passages.length
    ? `I found relevant information in the connected workspace, but the AI answer generator is temporarily unavailable. Here are the most relevant passages:\n\n${passages.join('\n\n')}`
    : 'I could not find this information in the connected workspace documents.';
}

function normalizeSource(source: string): Citation['source'] {
  if (source === 'google_drive' || source === 'notion' || source === 'jira') return source;
  return 'other';
}

export async function processKnowledgeQuery(
  userQuery: string,
  workspaceId?: string,
  authorization?: string,
  conversationContext?: string
): Promise<KnowledgeAgentResponse> {
  let documents: KnowledgeDocument[] = [];
  let retrievalError: string | undefined;

  try {
    if (authorization && workspaceId) {
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';
      const response = await fetch(backendUrl + '/rag/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authorization },
        body: JSON.stringify({ query: userQuery, match_count: 8 }),
        cache: 'no-store',
      });
      if (response.ok) {
        const rag = (await response.json()) as { results?: KnowledgeDocument[] };
        documents = usableDocuments(rag.results || []);
      } else {
        throw new Error('RAG search failed with status ' + response.status);
      }
    }

  } catch (err) {
    retrievalError = err instanceof Error ? err.message : 'The connected knowledge search failed.';
    console.warn('Backend RAG retrieval failed; trying direct Supabase retrieval:', err);
  }

  // Keep chat useful when the backend RAG service is temporarily unavailable.
  if (documents.length === 0 && workspaceId) {
    try {
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
      if (error) throw error;
      if (data && data.length > 0) {
        documents = usableDocuments(data as KnowledgeDocument[]);
      }
    } catch (err) {
      const fallbackError = err instanceof Error ? err.message : 'Direct workspace search failed.';
      retrievalError = retrievalError ? `${retrievalError}; ${fallbackError}` : fallbackError;
      console.warn('Direct Supabase RAG retrieval failed:', err);
    }
  }

  documents = usableDocuments(documents);

  const citations: Citation[] = documents.map((doc, idx) => ({
    id: doc.id || 'chunk-' + (idx + 1),
    title: doc.title,
    source: normalizeSource(doc.source),
    url: doc.url,
    snippet: doc.content.slice(0, 200) + (doc.content.length > 200 ? '...' : ''),
  }));

  const contextText = documents.length > 0
    ? documents
      .map((doc, idx) => '[Source ' + (idx + 1) + ': ' + doc.title + ' (' + doc.source + ')]\nURL: ' + (doc.url || 'Unavailable') + '\n' + doc.content)
      .join('\n\n')
      .slice(0, MAX_CONTEXT_CHARACTERS)
    : 'No matching connected workspace documents were found.';

  const systemPrompt = 'You are the Knowledge Agent of Enterprise AI Workspace.\n' +
    'Answer the employee question directly and strictly from the provided document context.\n' +
    'Synthesize the answer from the source text. Never respond with only document links, document titles, or instructions to read the sources.\n' +
    'Cite factual claims inline using [Source X]. Use only the source numbers shown in the context.\n' +
    'If context does not contain the answer, state that information was not found in connected workspace documents.\n' +
    'Keep the response professional, concise, and structured in markdown.\n\n' +
    'DOCUMENT CONTEXT:\n' + contextText;

  let llmResponse = '';
  let llmError: string | undefined;
  try {
    llmResponse = await generateGroqCompletion(systemPrompt, conversationContext ? `Recent conversation:\n${conversationContext}\n\nCurrent question:\n${userQuery}` : userQuery);
  } catch (err) {
    llmError = err instanceof Error ? err.message : 'The language model failed.';
  }
  const answer = llmResponse || (llmError
    ? buildExtractiveFallback(documents)
    : 'I could not find this information in the connected workspace documents.');

  return {
    answer,
    citations,
    retrievalStatus: llmError ? 'llm_failure' : retrievalError && !documents.length ? 'retrieval_failure' : documents.length ? 'ok' : 'no_evidence',
    error: llmError || retrievalError,
  };
}
