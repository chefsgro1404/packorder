import { NextRequest } from "next/server";
import { proxyToFunctions } from "@/lib/proxy";
export async function POST(request: NextRequest) {
  return proxyToFunctions(request, "shipment/scan-extra");
}
