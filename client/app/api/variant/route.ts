import { NextRequest } from "next/server";
import { proxyToFunctions } from "@/lib/proxy";

export async function GET(request: NextRequest) {
  return proxyToFunctions(request, "variant");
}

export async function PATCH(request: NextRequest) {
  return proxyToFunctions(request, "variant");
}
