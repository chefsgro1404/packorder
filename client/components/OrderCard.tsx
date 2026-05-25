"use client";

import { Order } from "@/lib/types";
import { Package, Truck, MapPin } from "lucide-react";

interface OrderCardProps {
  order: Order;
  onFulfill: () => void;
  loading?: boolean;
}

const fulfillmentColors: Record<string, string> = {
  FULFILLED: "bg-green-900/50 text-green-400 border-green-800",
  UNFULFILLED: "bg-slate-800 text-slate-400 border-slate-700",
  PARTIAL: "bg-yellow-900/50 text-yellow-400 border-yellow-800",
  IN_PROGRESS: "bg-blue-900/50 text-blue-400 border-blue-800",
};

export function OrderCard({ order, onFulfill, loading }: OrderCardProps) {
  const statusColor = fulfillmentColors[order.displayFulfillmentStatus] || fulfillmentColors.UNFULFILLED;
  const trackingNumber = order.metafield?.value;
  const carrier = order.trackingCarrier?.value;

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-2xl p-4 animate-in slide-in-from-bottom-4 duration-300 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xl font-bold text-slate-100">{order.name}</h3>
          {order.shippingAddress && (
            <div className="flex items-center gap-1.5 mt-1 text-sm text-slate-400">
              <MapPin className="w-3.5 h-3.5" />
              <span>{order.shippingAddress.name} — {order.shippingAddress.city}, {order.shippingAddress.provinceCode}</span>
            </div>
          )}
        </div>
        <span className={`text-xs px-2.5 py-1 rounded-full border font-medium ${statusColor}`}>
          {order.displayFulfillmentStatus}
        </span>
      </div>

      <div className="space-y-1">
        {order.lineItems.edges.map(({ node }) => (
          <div key={node.id} className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2 text-slate-300">
              <Package className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              <span className="truncate">{node.name}</span>
            </div>
            <span className="text-slate-400 ml-2 shrink-0">×{node.quantity}</span>
          </div>
        ))}
      </div>

      {trackingNumber ? (
        <div className="bg-slate-800 rounded-xl p-3 space-y-1">
          <div className="flex items-center gap-2 text-xs text-slate-400 uppercase tracking-wide font-medium">
            <Truck className="w-3.5 h-3.5" />
            <span>Tracking</span>
          </div>
          <p className="font-mono text-sm text-blue-300 break-all">{trackingNumber}</p>
          {carrier && <p className="text-xs text-slate-500">{carrier}</p>}
        </div>
      ) : (
        <div className="bg-orange-950/50 border border-orange-900 rounded-xl p-3 text-sm text-orange-400">
          No tracking number yet — create a label in XPS first.
        </div>
      )}

      <button
        onClick={onFulfill}
        disabled={loading || !trackingNumber || order.displayFulfillmentStatus === "FULFILLED"}
        className="w-full py-4 bg-green-700 hover:bg-green-600 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed rounded-xl font-bold text-base transition-all duration-150 min-h-[56px] flex items-center justify-center gap-2"
      >
        <Truck className="w-5 h-5" />
        {loading ? "Fulfilling..." : "Fulfill & Ship"}
      </button>
    </div>
  );
}
