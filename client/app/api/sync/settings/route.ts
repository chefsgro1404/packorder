import { NextRequest } from "next/server";
import { proxyToFunctions } from "@/lib/proxy";

export async function GET(request: NextRequest) {
  return proxyToFunctions(request, "sync/settings");
}

export async function PUT(request: NextRequest) {
  return proxyToFunctions(request, "sync/settings");
}

export async function OPTIONS(request: NextRequest) {
  return proxyToFunctions(request, "sync/settings");
}
