"use client";

import { CartItem } from "@/lib/types";
import { Minus, Plus, Trash2, ShoppingBag } from "lucide-react";

interface CartDrawerProps {
  open: boolean;
  onClose: () => void;
  items: CartItem[];
  total: string;
  onRemoveItem: (variantId: string) => void;
  onCheckout: () => void;
  checkoutLoading?: boolean;
}

export function CartDrawer({
  open,
  onClose,
  items,
  total,
  onRemoveItem,
  onCheckout,
  checkoutLoading,
}: CartDrawerProps) {
  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-black/60 z-40 transition-opacity duration-300 ${
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        className={`fixed bottom-0 left-0 right-0 z-50 bg-[var(--bg-card)] border-t border-[var(--border-color)] rounded-t-3xl transition-transform duration-300 ease-out ${
          open ? "translate-y-0" : "translate-y-full"
        }`}
        style={{ maxHeight: "80vh", paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))" }}
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-[var(--border-color)]">
          <div className="w-10 h-1 bg-[var(--bg-elevated)] rounded-full mx-auto absolute left-1/2 -translate-x-1/2 top-3" />
          <h2 className="text-lg font-bold flex items-center gap-2 mt-2 text-[var(--text-primary)]">
            <ShoppingBag className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            Cart
            {items.length > 0 && (
              <span className="text-sm bg-blue-600 text-white px-2 py-0.5 rounded-full">{items.length}</span>
            )}
          </h2>
          <button
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors mt-2 min-w-[48px] min-h-[48px] flex items-center justify-center"
          >
            ✕
          </button>
        </div>

        <div className="overflow-y-auto" style={{ maxHeight: "calc(80vh - 180px)" }}>
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-[var(--text-muted)]">
              <ShoppingBag className="w-12 h-12 mb-3 opacity-30" />
              <p>Cart is empty</p>
            </div>
          ) : (
            <div className="px-4 py-3 space-y-3">
              {items.map((item) => (
                <div
                  key={item.variantId}
                  className="flex items-center gap-3 bg-[var(--bg-elevated)] rounded-xl p-3"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm leading-tight truncate text-[var(--text-primary)]">{item.productTitle}</p>
                    {item.variantTitle !== "Default Title" && (
                      <p className="text-xs text-[var(--text-muted)] mt-0.5">{item.variantTitle}</p>
                    )}
                    <p className="text-blue-600 dark:text-blue-400 font-semibold text-sm mt-1">
                      ${(parseFloat(item.price) * item.quantity).toFixed(2)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onRemoveItem(item.variantId)}
                      className="w-8 h-8 rounded-lg bg-[var(--bg-input)] hover:bg-[var(--bg-elevated)] flex items-center justify-center transition-colors"
                    >
                      {item.quantity === 1 ? (
                        <Trash2 className="w-3.5 h-3.5 text-red-500 dark:text-red-400" />
                      ) : (
                        <Minus className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
                      )}
                    </button>
                    <span className="w-6 text-center font-semibold text-[var(--text-primary)]">{item.quantity}</span>
                    <div className="w-8 h-8 rounded-lg bg-[var(--bg-input)] flex items-center justify-center">
                      <Plus className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {items.length > 0 && (
          <div className="px-4 pt-3 border-t border-[var(--border-color)]">
            <div className="flex justify-between items-center mb-3">
              <span className="text-[var(--text-secondary)]">Total</span>
              <span className="text-2xl font-bold text-[var(--text-primary)]">${total}</span>
            </div>
            <button
              onClick={onCheckout}
              disabled={checkoutLoading}
              className="w-full py-4 bg-blue-600 hover:bg-blue-500 active:scale-[0.98] disabled:opacity-50 rounded-xl font-bold text-base text-white transition-all duration-150 min-h-[56px]"
            >
              {checkoutLoading ? "Processing..." : "Complete Sale"}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
