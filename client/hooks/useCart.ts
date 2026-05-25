"use client";

import { useState, useEffect, useCallback } from "react";
import { CartItem, CartState } from "@/lib/types";

const STORAGE_KEY = "shipscan_cart";

function computeTotal(items: CartItem[]): string {
  const total = items.reduce((sum, item) => {
    return sum + parseFloat(item.price) * item.quantity;
  }, 0);
  return total.toFixed(2);
}

function loadFromStorage(): Omit<CartState, "total"> {
  if (typeof window === "undefined") return { items: [], draftOrderId: null };
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return { items: [], draftOrderId: null };
    return JSON.parse(raw);
  } catch {
    return { items: [], draftOrderId: null };
  }
}

function saveToStorage(data: Omit<CartState, "total">) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function useCart() {
  const [items, setItems] = useState<CartItem[]>([]);
  const [draftOrderId, setDraftOrderId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const stored = loadFromStorage();
    setItems(stored.items);
    setDraftOrderId(stored.draftOrderId);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) {
      saveToStorage({ items, draftOrderId });
    }
  }, [items, draftOrderId, hydrated]);

  const addItem = useCallback((item: CartItem) => {
    setItems((prev) => {
      const existing = prev.find((i) => i.variantId === item.variantId);
      if (existing) {
        return prev.map((i) =>
          i.variantId === item.variantId ? { ...i, quantity: i.quantity + item.quantity } : i
        );
      }
      return [...prev, item];
    });
  }, []);

  const removeItem = useCallback((variantId: string) => {
    setItems((prev) => {
      const existing = prev.find((i) => i.variantId === variantId);
      if (!existing) return prev;
      if (existing.quantity > 1) {
        return prev.map((i) =>
          i.variantId === variantId ? { ...i, quantity: i.quantity - 1 } : i
        );
      }
      return prev.filter((i) => i.variantId !== variantId);
    });
  }, []);

  const clearCart = useCallback(() => {
    setItems([]);
    setDraftOrderId(null);
    if (typeof window !== "undefined") {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const total = computeTotal(items);

  return { items, draftOrderId, setDraftOrderId, total, addItem, removeItem, clearCart };
}
