import { NextRequest } from "next/server";
import { proxyToFunctions } from "@/lib/proxy";
export async function POST(request: NextRequest) {
  return proxyToFunctions(request, "qr/decrypt");
}
export async function OPTIONS(request: NextRequest) {
  return proxyToFunctions(request, "qr/decrypt");
}
