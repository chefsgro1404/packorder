"use client";

import { Order } from "@/lib/types";
import { Package, Truck, MapPin } from "lucide-react";

interface OrderCardProps {
  order: Order;
  onFulfill: () => void;
  loading?: boolean;
}

const fulfillmentColors: Record<string, string> = {
  FULFILLED: "bg-green-50 text-green-700 border-green-200 dark:bg-green-900/50 dark:text-green-400 dark:border-green-800",
  UNFULFILLED: "bg-[var(--bg-elevated)] text-[var(--text-muted)] border-[var(--border-color)]",
  PARTIAL: "bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-900/50 dark:text-yellow-400 dark:border-yellow-800",
  IN_PROGRESS: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/50 dark:text-blue-400 dark:border-blue-800",
};

export function OrderCard({ order, onFulfill, loading }: OrderCardProps) {
  const statusColor = fulfillmentColors[order.displayFulfillmentStatus] || fulfillmentColors.UNFULFILLED;
  const trackingNumber = order.metafield?.value;
  const carrier = order.trackingCarrier?.value;

  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-2xl p-4 animate-in slide-in-from-bottom-4 duration-300 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xl font-bold text-[var(--text-primary)]">{order.name}</h3>
          {order.shippingAddress && (
            <div className="flex items-center gap-1.5 mt-1 text-sm text-[var(--text-secondary)]">
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
            <div className="flex items-center gap-2 text-[var(--text-secondary)]">
              <Package className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
              <span className="truncate">{node.name}</span>
            </div>
            <span className="text-[var(--text-muted)] ml-2 shrink-0">×{node.quantity}</span>
          </div>
        ))}
      </div>

      {trackingNumber ? (
        <div className="bg-[var(--bg-elevated)] rounded-xl p-3 space-y-1">
          <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] uppercase tracking-wide font-medium">
            <Truck className="w-3.5 h-3.5" />
            <span>Tracking</span>
          </div>
          <p className="font-mono text-sm text-blue-600 dark:text-blue-300 break-all">{trackingNumber}</p>
          {carrier && <p className="text-xs text-[var(--text-muted)]">{carrier}</p>}
        </div>
      ) : (
        <div className="bg-orange-50 border border-orange-200 dark:bg-orange-950/50 dark:border-orange-900 rounded-xl p-3 text-sm text-orange-700 dark:text-orange-400">
          No tracking number yet — create a label in XPS first.
        </div>
      )}

      <button
        onClick={onFulfill}
        disabled={loading || !trackingNumber || order.displayFulfillmentStatus === "FULFILLED"}
        className="w-full py-4 bg-green-700 hover:bg-green-600 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed rounded-xl font-bold text-base text-white transition-all duration-150 min-h-[56px] flex items-center justify-center gap-2"
      >
        <Truck className="w-5 h-5" />
        {loading ? "Fulfilling..." : "Fulfill & Ship"}
      </button>
    </div>
  );
}
