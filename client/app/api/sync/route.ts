import { NextRequest } from "next/server";
import { proxyToFunctions } from "@/lib/proxy";

export const maxDuration = 120;

export async function POST(request: NextRequest) {
  return proxyToFunctions(request, "sync");
}
