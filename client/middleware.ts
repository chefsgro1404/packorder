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
  // Paths with a file extension (sw.js, workbox-*.js, manifest.json, icons, downloads, and the
  // platform's warm-up probe /robots933456.txt) are never redirected — a 307 to the login page
  // breaks the service worker and the Azure SWA warm-up check.
  matcher: ["/((?!api/|_next/|.*\\..*).+)"],
};
