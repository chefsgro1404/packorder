import { NextRequest } from "next/server";
import { proxyToFunctions } from "@/lib/proxy";
export async function PATCH(request: NextRequest) {
  return proxyToFunctions(request, "shipment/notes");
}
