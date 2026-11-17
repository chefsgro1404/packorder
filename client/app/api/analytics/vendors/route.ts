import { NextRequest, NextResponse } from "next/server";
import { getVendorTable, getLotCompliance, getDiscrepancies } from "@/lib/analytics/queries";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const days = Math.min(365, Math.max(1, Number(req.nextUrl.searchParams.get("days") ?? "30")));
  const view = req.nextUrl.searchParams.get("view") ?? "vendors"; // vendors | lots | discrepancies
  try {
    if (view === "lots") {
      const rows = await getLotCompliance(days);
      return NextResponse.json({ ok: true, days, view, rows });
    }
    if (view === "discrepancies") {
      const rows = await getDiscrepancies(days);
      return NextResponse.json({ ok: true, days, view, rows });
    }
    const rows = await getVendorTable(days);
    return NextResponse.json({ ok: true, days, view, rows });
  } catch (err) {
    console.error("analytics/vendors error", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
