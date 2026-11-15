import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const token = request.cookies.get("access_token");

  if (!token) {
    const loginUrl = new URL("/", request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  // Protect every page except the login root (/), API routes, and Next.js internals.
  // Adding a new page under any path now requires no middleware change.
  matcher: ["/((?!$|api/|_next/|favicon.ico|icons/|manifest.json).*)"],
};
