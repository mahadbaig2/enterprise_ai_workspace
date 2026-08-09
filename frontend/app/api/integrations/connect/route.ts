import { NextResponse } from 'next/server';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Internal Server Error';
}

export async function POST(req: Request) {
  try {
    const { provider } = (await req.json()) as { provider?: string };

    const mockAuthUrls: Record<string, string> = {
      google_drive: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=demo&response_type=code',
      notion: 'https://api.notion.com/v1/oauth/authorize?client_id=demo',
      jira: 'https://auth.atlassian.com/authorize?client_id=demo',
    };

    return NextResponse.json({
      success: true,
      authUrl: provider ? mockAuthUrls[provider] || '#' : '#',
      provider,
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
