import { NextRequest, NextResponse } from "next/server";

export async function proxyToFunctions(
  req: NextRequest,
  path: string,
  options?: { method?: string }
): Promise<NextResponse> {
  const baseUrl = process.env.AZURE_FUNCTIONS_URL;
  const secret = process.env.INTERNAL_API_SECRET;

  if (!baseUrl || !secret) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  const url = new URL(`/api/${path}`, baseUrl);
  req.nextUrl.searchParams.forEach((value, key) => {
    url.searchParams.set(key, value);
  });

  const method = options?.method ?? req.method;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Internal-Secret": secret,
  };

  // Forward browser cookies to Functions so it can validate the access_token cookie
  const cookieHeader = req.headers.get("cookie");
  if (cookieHeader) headers["Cookie"] = cookieHeader;

  const body =
    ["POST", "PUT", "PATCH"].includes(method) ? await req.text() : undefined;

  let azureRes: Response;
  try {
    // Sync can legitimately run close to the backend's functionTimeout (9.5 min, host.json) — give it
    // a little more than that so we only time out here if the backend would have anyway. Everything
    // else should be fast and fails quickly to surface real connectivity problems.
    const timeoutMs = path.startsWith("sync/") ? 10 * 60_000 : 30_000;
    azureRes = await fetch(url.toString(), { method, headers, body, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      return NextResponse.json({ error: "Backend request timed out" }, { status: 504 });
    }
    return NextResponse.json({ error: "Backend unreachable" }, { status: 502 });
  }

  let azureJson: { success: boolean; data?: unknown; error?: string };
  try {
    azureJson = await azureRes.json();
  } catch {
    return NextResponse.json({ error: "Invalid backend response" }, { status: 502 });
  }

  if (!azureJson.success) {
    const extra: Record<string, boolean> = {};
    if (azureRes.status === 409) extra.alreadyFulfilled = true;
    if (
      azureRes.status === 422 &&
      typeof azureJson.error === "string" &&
      azureJson.error.toLowerCase().includes("tracking")
    ) {
      extra.noLabel = true;
    }
    const errResponse = NextResponse.json(
      { error: azureJson.error, ...extra },
      { status: azureRes.status }
    );
    forwardSetCookieHeaders(azureRes, errResponse);
    return errResponse;
  }

  const response = NextResponse.json(azureJson.data ?? {}, { status: 200 });
  // Forward Set-Cookie headers from Functions to the browser (login sets tokens; logout clears them)
  forwardSetCookieHeaders(azureRes, response);
  return response;
}

function forwardSetCookieHeaders(azureRes: Response, nextRes: NextResponse): void {
  const setCookies: string[] =
    typeof (azureRes.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === "function"
      ? (azureRes.headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
      : azureRes.headers.get("set-cookie")
      ? [azureRes.headers.get("set-cookie")!]
      : [];

  for (const cookie of setCookies) {
    nextRes.headers.append("Set-Cookie", cookie);
  }
}
