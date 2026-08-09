import { NextResponse } from 'next/server';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Internal Server Error';
}

async function readError(res: Response): Promise<string> {
  const err = await res.json().catch(() => ({ detail: 'Unknown error' }));
  return err.detail || 'HTTP ' + res.status;
}

export async function POST(req: Request) {
  try {
    const { provider } = (await req.json().catch(() => ({}))) as { provider?: string };
    const authHeader = req.headers.get('authorization');

    if (!authHeader) {
      return NextResponse.json({ error: 'Authorization header is required.' }, { status: 401 });
    }

    const syncPath = provider ? '/sync/' + provider : '/sync';
    const res = await fetch(BACKEND_URL + syncPath, {
      method: 'POST',
      headers: { Authorization: authHeader },
      cache: 'no-store',
    });

    if (!res.ok) {
      return NextResponse.json({ error: await readError(res) }, { status: res.status });
    }

    const syncData = await res.json();
    if (provider !== 'jira') {
      const indexRes = await fetch(BACKEND_URL + '/rag/index', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader },
        body: JSON.stringify({ source: provider || null }),
        cache: 'no-store',
      });
      if (indexRes.ok) {
        syncData.rag_index = await indexRes.json();
      } else {
        syncData.rag_index_error = await readError(indexRes);
      }
    }

    return NextResponse.json(syncData);
  } catch (error: unknown) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
