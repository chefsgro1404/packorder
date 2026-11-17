import { NextRequest, NextResponse } from "next/server";
import { getDailyTrends } from "@/lib/analytics/queries";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const days = Math.min(90, Math.max(7, Number(req.nextUrl.searchParams.get("days") ?? "30")));
  try {
    const trends = await getDailyTrends(days);
    return NextResponse.json({ ok: true, days, trends });
  } catch (err) {
    console.error("analytics/trends error", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
