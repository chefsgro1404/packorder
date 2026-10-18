import { NextRequest } from "next/server";
import { proxyToFunctions } from "@/lib/proxy";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return proxyToFunctions(request, `print-jobs/${id}/claim`);
}
