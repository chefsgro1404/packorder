import { NextRequest } from "next/server";
import { proxyToFunctions } from "@/lib/proxy";

export async function GET(request: NextRequest) {
  return proxyToFunctions(request, "scale/lot-products");
}

export async function POST(request: NextRequest) {
  return proxyToFunctions(request, "scale/lot-products");
}
