import { NextRequest, NextResponse } from "next/server";
import {
  getLabelSummary,
  getFillRateSummary,
  getWastageSummary,
  getTransformationSummary,
  getTopProducts,
} from "@/lib/analytics/queries";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const days = Math.min(365, Math.max(1, Number(req.nextUrl.searchParams.get("days") ?? "30")));
  try {
    const [labels, fillRate, wastage, transformation, topProducts] = await Promise.all([
      getLabelSummary(days),
      getFillRateSummary(days),
      getWastageSummary(days),
      getTransformationSummary(days),
      getTopProducts(days),
    ]);
    return NextResponse.json({ ok: true, days, labels, fillRate, wastage, transformation, topProducts });
  } catch (err) {
    console.error("analytics/summary error", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
