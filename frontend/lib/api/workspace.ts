const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
  created_at: string;
}

export async function createWorkspace(
  name: string,
  token: string
): Promise<Workspace> {
  const res = await fetch(`${BACKEND_URL}/workspace`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ name }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }

  return res.json();
}

export async function getWorkspace(token: string): Promise<Workspace | null> {
  const res = await fetch(`${BACKEND_URL}/workspace`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    // Don't cache — always fresh so the middleware redirect stays correct
    cache: 'no-store',
  });

  if (res.status === 404) return null;

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }

  return res.json();
}
