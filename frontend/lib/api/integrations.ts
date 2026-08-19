const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

export type IntegrationStatus = 'connected' | 'disconnected' | 'error';

export interface Integration {
  id: string;
  workspace_id: string;
  provider: string;
  status: IntegrationStatus;
  connected_account_email: string | null;
  connected_at: string | null;
  error_message: string | null;
}

export interface ConnectResponse {
  redirect_url: string;
  provider: string;
}

async function readError(res: Response): Promise<string> {
  const err = await res.json().catch(() => ({ detail: 'Unknown error' }));
  return err.detail || `HTTP ${res.status}`;
}

export async function getIntegrations(token: string): Promise<Integration[]> {
  const res = await fetch(`${BACKEND_URL}/integrations`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    cache: 'no-store',
  });

  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function getIntegration(
  provider: string,
  token: string
): Promise<Integration> {
  const res = await fetch(`${BACKEND_URL}/integrations/${provider}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    cache: 'no-store',
  });

  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function connectIntegration(
  provider: string,
  token: string
): Promise<ConnectResponse> {
  const res = await fetch(`${BACKEND_URL}/integrations/${provider}/connect`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function verifyIntegrationCallback(
  provider: string,
  connectionId: string | null,
  token: string
): Promise<Integration> {
  const params = new URLSearchParams();
  if (connectionId) params.set('connection_id', connectionId);

  const res = await fetch(
    `${BACKEND_URL}/integrations/${provider}/callback?${params.toString()}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: 'no-store',
    }
  );

  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function testIntegration(
  provider: string,
  token: string
): Promise<Integration> {
  const res = await fetch(`${BACKEND_URL}/integrations/${provider}/test`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    cache: 'no-store',
  });

  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function disconnectIntegration(
  provider: string,
  token: string
): Promise<void> {
  const res = await fetch(`${BACKEND_URL}/integrations/${provider}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) throw new Error(await readError(res));
}

export async function syncIntegration(
  provider: string,
  token: string
): Promise<unknown> {
  const res = await fetch('/api/sync', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ provider }),
    cache: 'no-store',
  });

  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}
