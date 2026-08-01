import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

export default async function proxy(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { session },
  } = await supabase.auth.getSession();

  const user = session?.user ?? null;
  const pathname = request.nextUrl.pathname;

  const isAuthPage = pathname.startsWith('/login') || pathname.startsWith('/signup');
  const isAuthCallback = pathname.startsWith('/auth/callback');
  const isLandingPage = pathname === '/';
  const isWorkspaceNew = pathname.startsWith('/workspace/new');

  // 1. Unauthenticated → /login (except public routes)
  if (!user && !isAuthPage && !isAuthCallback && !isLandingPage) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  // 2. Authenticated + auth pages → /dashboard
  if (user && isAuthPage) {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    return NextResponse.redirect(url);
  }

  // 3. Authenticated + /dashboard → check workspace exists server-side
  if (user && pathname === '/dashboard' && session?.access_token) {
    try {
      const workspaceRes = await fetch(`${BACKEND_URL}/workspace`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
        signal: AbortSignal.timeout(3000), // 3 s timeout to stay lightweight
      });

      if (workspaceRes.status === 404) {
        // No workspace yet — send to creation flow
        const url = request.nextUrl.clone();
        url.pathname = '/workspace/new';
        return NextResponse.redirect(url);
      }
      // 401 / 5xx: fall through and let the page handle it gracefully
    } catch {
      // Network error or timeout — allow through rather than looping
    }
  }

  // 4. Authenticated + /workspace/new but workspace already exists → /dashboard
  if (user && isWorkspaceNew && session?.access_token) {
    try {
      const workspaceRes = await fetch(`${BACKEND_URL}/workspace`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
        signal: AbortSignal.timeout(3000),
      });

      if (workspaceRes.ok) {
        const url = request.nextUrl.clone();
        url.pathname = '/dashboard';
        return NextResponse.redirect(url);
      }
    } catch {
      // Allow through on error
    }
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|auth/callback|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
