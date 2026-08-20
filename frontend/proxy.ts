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

  let session = null;
  try {
    const result = await Promise.race([
      supabase.auth.getSession(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Auth session lookup timed out')), 5000)),
    ]);
    session = result.data.session;
  } catch {
    session = null;
  }

  const user = session?.user ?? null;
  const pathname = request.nextUrl.pathname;

  const isAuthPage = pathname.startsWith('/login') || pathname.startsWith('/signup');
  const isAuthCallback = pathname.startsWith('/auth/callback');
  const isLandingPage = pathname === '/';
  const isApiRoute = pathname.startsWith('/api/');
  const isWorkspaceNew = pathname.startsWith('/workspace/new');
  const isOnboarding = pathname.startsWith('/onboarding');

  // 1. Unauthenticated → /login (except public routes)
  if (!user && !isAuthPage && !isAuthCallback && !isLandingPage && !isApiRoute) {
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
  if (user && (pathname === '/dashboard' || isOnboarding) && session?.access_token) {
    try {
      const workspaceRes = await fetch(`${BACKEND_URL}/workspace`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
        signal: AbortSignal.timeout(1200), // 3 s timeout to stay lightweight
      });

      if (workspaceRes.status === 404) {
        // No workspace yet — send to creation flow
        const url = request.nextUrl.clone();
        url.pathname = '/workspace/new';
        return NextResponse.redirect(url);
      }

      if (workspaceRes.ok) {
        const onboardingRes = await fetch(`${BACKEND_URL}/onboarding`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
          signal: AbortSignal.timeout(1200),
        });

        if (onboardingRes.ok) {
          const onboarding = await onboardingRes.json();

          if (pathname === '/dashboard' && !onboarding.completed) {
            const url = request.nextUrl.clone();
            url.pathname = '/onboarding';
            return NextResponse.redirect(url);
          }

          if (isOnboarding && onboarding.completed) {
            const url = request.nextUrl.clone();
            url.pathname = '/dashboard';
            return NextResponse.redirect(url);
          }
        }
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
        signal: AbortSignal.timeout(1200),
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
