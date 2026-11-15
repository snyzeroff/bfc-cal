import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic gate only: sends visitors without a session cookie to the login
 * page. Real authorisation happens on the server for every page and action.
 */
export function proxy(request: NextRequest) {
  if (!request.cookies.has("bfc_session")) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/board/:path*"] };
