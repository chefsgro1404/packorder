import { NextRequest } from "next/server";
import { proxyToFunctions } from "@/lib/proxy";

export async function GET(request: NextRequest) {
  return proxyToFunctions(request, "scale/products/by-variant");
}

export async function PUT(request: NextRequest) {
  return proxyToFunctions(request, "scale/products/by-variant");
}

export async function DELETE(request: NextRequest) {
  return proxyToFunctions(request, "scale/products/by-variant");
}
