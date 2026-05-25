import { NextRequest } from "next/server";
import { proxyToFunctions } from "@/lib/proxy";

export async function GET(request: NextRequest) {
  return proxyToFunctions(request, "auth");
}

export async function POST(request: NextRequest) {
  return proxyToFunctions(request, "auth");
}

export async function DELETE(request: NextRequest) {
  return proxyToFunctions(request, "auth", { method: "DELETE" });
}
