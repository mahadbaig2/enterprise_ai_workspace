import hashlib
import logging
import os
import re
from typing import Any

import httpx

from app.models.rag import (
    RagCitation,
    RagIndexResponse,
    RagSearchRequest,
    RagSearchResponse,
    RagSearchResult,
)
from app.utils.supabase_client import get_admin_client

logger = logging.getLogger(__name__)
CHUNK_SIZE = 1200
CHUNK_OVERLAP = 180
WORD_PATTERN = re.compile(r"\w+", re.UNICODE)


def _embedding_configured() -> bool:
    return bool(os.getenv("EMBEDDING_API_KEY")) and os.getenv("EMBEDDING_API_KEY") != "your-embedding-api-key-here"


def _chunk_text(content: str) -> list[str]:
    normalized = re.sub(r"\s+", " ", content or "").strip()
    if not normalized:
        return []
    chunks: list[str] = []
    start = 0
    while start < len(normalized):
        end = min(start + CHUNK_SIZE, len(normalized))
        if end < len(normalized):
            boundary = normalized.rfind(" ", start, end)
            if boundary > start + CHUNK_SIZE // 2:
                end = boundary
        chunk = normalized[start:end].strip()
        if chunk:
            chunks.append(chunk)
        if end >= len(normalized):
            break
        start = max(end - CHUNK_OVERLAP, start + 1)
    return chunks


def _generate_embeddings(texts: list[str]) -> list[list[float] | None]:
    if not texts or not _embedding_configured():
        return [None for _ in texts]
    headers = {
        "Authorization": f"Bearer {os.environ['EMBEDDING_API_KEY']}",
        "Content-Type": "application/json",
    }
    payload: dict[str, Any] = {
        "model": os.getenv("EMBEDDING_MODEL", "text-embedding-3-small"),
        "input": texts,
    }
    dimensions = os.getenv("EMBEDDING_DIMENSIONS")
    if dimensions:
        payload["dimensions"] = int(dimensions)
    try:
        with httpx.Client(timeout=float(os.getenv("EMBEDDING_TIMEOUT", "45"))) as client:
            response = client.post(
                os.getenv("EMBEDDING_API_URL", "https://api.openai.com/v1/embeddings"),
                headers=headers,
                json=payload,
            )
            response.raise_for_status()
            data = response.json().get("data", [])
    except (httpx.HTTPError, ValueError, KeyError) as exc:
        logger.warning("Embedding provider unavailable; using lexical retrieval: %s", exc)
        return [None for _ in texts]
    ordered = sorted(data, key=lambda item: item.get("index", 0))
    embeddings = [item.get("embedding") for item in ordered]
    if len(embeddings) != len(texts) or any(not isinstance(item, list) for item in embeddings):
        logger.warning("Embedding provider returned an unexpected response shape")
        return [None for _ in texts]
    return embeddings


def index_workspace_documents(workspace_id: str, source: str | None = None) -> RagIndexResponse:
    db = get_admin_client()
    query = db.table("documents").select("id,workspace_id,source,title,content,url,metadata").eq("workspace_id", workspace_id)
    if source:
        query = query.eq("source", source)
    documents = query.execute().data or []
    chunks_stored = 0
    embeddings_stored = 0
    for document in documents:
        chunks = _chunk_text(document.get("content", ""))
        db.table("document_chunks").delete().eq("document_id", document["id"]).execute()
        embeddings = _generate_embeddings(chunks)
        rows = []
        for index, (chunk, embedding) in enumerate(zip(chunks, embeddings)):
            rows.append({
                "document_id": document["id"],
                "workspace_id": workspace_id,
                "chunk_index": index,
                "content": chunk,
                "content_hash": hashlib.sha256(chunk.encode("utf-8")).hexdigest(),
                "token_count": len(WORD_PATTERN.findall(chunk)),
                "metadata": {
                    "source": document.get("source"),
                    "title": document.get("title"),
                    "url": document.get("url"),
                    "chunk_start": index * max(CHUNK_SIZE - CHUNK_OVERLAP, 1),
                },
                "embedding": embedding,
            })
        if rows:
            result = db.table("document_chunks").upsert(rows, on_conflict="document_id,chunk_index").execute()
            chunks_stored += len(result.data or rows)
            embeddings_stored += sum(1 for embedding in embeddings if embedding is not None)
    return RagIndexResponse(
        workspace_id=workspace_id,
        documents_indexed=len(documents),
        chunks_stored=chunks_stored,
        embeddings_stored=embeddings_stored,
        embedding_provider=os.getenv("EMBEDDING_PROVIDER", "openai-compatible") if _embedding_configured() else "disabled",
    )


def _tokens(value: str) -> set[str]:
    return {token.lower() for token in WORD_PATTERN.findall(value) if len(token) > 2}


def _lexical_rerank(query: str, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    query_tokens = _tokens(query)
    for row in rows:
        content = f"{row.get('title', '')} {row.get('content', '')}"
        overlap = len(query_tokens & _tokens(content)) / max(len(query_tokens), 1)
        exact_match = 1.0 if query.lower() in row.get("content", "").lower() else 0.0
        row["rerank_score"] = min(1.0, overlap * 0.8 + exact_match * 0.2)
    return sorted(rows, key=lambda item: item["rerank_score"], reverse=True)


def _bge_rerank(query: str, rows: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], str]:
    endpoint = os.getenv("RERANKER_API_URL")
    if not endpoint or not rows:
        return _lexical_rerank(query, rows), "lexical-fallback"
    is_huggingface = "huggingface.co" in endpoint or "hf-inference" in endpoint
    if is_huggingface:
        payload = {
            "inputs": [
                {"text": query, "text_pair": row.get("content", "")}
                for row in rows
            ]
        }
    else:
        payload = {
            "model": os.getenv("RERANKER_MODEL", "BAAI/bge-reranker-v2-m3"),
            "query": query,
            "documents": [row.get("content", "") for row in rows],
            "top_n": len(rows),
        }
    headers = {"Content-Type": "application/json"}
    if os.getenv("RERANKER_API_KEY"):
        headers["Authorization"] = f"Bearer {os.environ['RERANKER_API_KEY']}"
    try:
        with httpx.Client(timeout=float(os.getenv("RERANKER_TIMEOUT", "20"))) as client:
            response = client.post(endpoint, headers=headers, json=payload)
            response.raise_for_status()
            data = response.json()
        if is_huggingface:
            predictions = data[0] if len(data) == 1 and isinstance(data[0], list) else data
            reranked = []
            for index, prediction in enumerate(predictions):
                if isinstance(prediction, dict):
                    reranked.append({"index": index, "score": prediction.get("score", 0)})
        else:
            reranked = data.get("results", [])
        for item in reranked:
            index = item.get("index")
            if isinstance(index, int) and 0 <= index < len(rows):
                rows[index]["rerank_score"] = float(item.get("relevance_score", item.get("score", 0)))
        if reranked:
            provider = "bge-huggingface" if is_huggingface else "bge"
            return sorted(rows, key=lambda item: item.get("rerank_score", 0), reverse=True), provider
    except (httpx.HTTPError, ValueError, TypeError) as exc:
        logger.warning("BGE reranker unavailable; using lexical reranking: %s", exc)
    return _lexical_rerank(query, rows), "lexical-fallback"


def _citation(row: dict[str, Any]) -> RagCitation:
    snippet = row.get("content", "").strip()
    if len(snippet) > 240:
        snippet = f"{snippet[:237].rstrip()}..."
    return RagCitation(
        id=str(row["id"]),
        document_id=str(row["document_id"]),
        title=row.get("title") or "Untitled document",
        source=row.get("source") or "other",
        url=row.get("url"),
        snippet=snippet,
        chunk_index=int(row.get("chunk_index", 0)),
    )


def search_workspace(workspace_id: str, request: RagSearchRequest) -> RagSearchResponse:
    query_embeddings = _generate_embeddings([request.query])
    query_embedding = query_embeddings[0] if query_embeddings else None
    params: dict[str, Any] = {
        "query_text": request.query,
        "query_embedding": str(query_embedding) if query_embedding else None,
        "match_threshold": float(os.getenv("RAG_MATCH_THRESHOLD", "0.15")),
        "match_count": request.match_count,
        "filter_workspace_id": workspace_id,
        "filter_sources": request.sources,
        "filter_metadata": request.metadata,
    }
    result = get_admin_client().rpc("match_document_chunks", params).execute()
    rows, reranker = _bge_rerank(request.query, [dict(row) for row in (result.data or [])])
    rows = rows[: request.match_count]
    search_results = [
        RagSearchResult(
            id=str(row["id"]),
            document_id=str(row["document_id"]),
            workspace_id=str(row["workspace_id"]),
            source=row.get("source") or "other",
            title=row.get("title") or "Untitled document",
            content=row.get("content") or "",
            url=row.get("url"),
            chunk_index=int(row.get("chunk_index", 0)),
            similarity=float(row.get("similarity") or 0),
            fts_rank=float(row.get("fts_rank") or 0),
            rerank_score=float(row.get("rerank_score") or 0),
            metadata=row.get("metadata") or {},
        )
        for row in rows
    ]
    return RagSearchResponse(
        query=request.query,
        results=search_results,
        citations=[_citation(row) for row in rows],
        reranker=reranker,
    )
