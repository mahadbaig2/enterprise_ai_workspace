const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

export interface Onboarding {
  id: string;
  workspace_id: string;
  current_step: number;
  completed: boolean;
  completed_at: string | null;
}

export async function getOnboarding(token: string): Promise<Onboarding | null> {
  const res = await fetch(`${BACKEND_URL}/onboarding`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    cache: 'no-store',
  });

  if (res.status === 404) return null;

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }

  return res.json();
}

export async function updateOnboarding(
  token: string,
  data: { current_step?: number; completed?: boolean }
): Promise<Onboarding> {
  const res = await fetch(`${BACKEND_URL}/onboarding`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }

  return res.json();
}
