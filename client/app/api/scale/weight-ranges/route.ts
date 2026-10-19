import { NextRequest } from "next/server";
import { proxyToFunctions } from "@/lib/proxy";

export async function GET(request: NextRequest) {
  return proxyToFunctions(request, "scale/weight-ranges");
}

export async function PUT(request: NextRequest) {
  return proxyToFunctions(request, "scale/weight-ranges");
}
