import { NextRequest } from "next/server";
import { proxyToFunctions } from "@/lib/proxy";

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return proxyToFunctions(request, `webhooks/${id}`, { method: "DELETE" });
}
