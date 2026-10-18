import { NextRequest } from "next/server";
import { proxyToFunctions } from "@/lib/proxy";

export async function GET(request: NextRequest) {
  return proxyToFunctions(request, "print-jobs");
}

export async function POST(request: NextRequest) {
  return proxyToFunctions(request, "print-jobs");
}
