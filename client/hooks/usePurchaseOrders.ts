'use client';

import { useState, useCallback, useEffect } from 'react';
import { PurchaseOrder, PurchaseOrderLineItem } from '@/lib/types';

interface PoWithItems {
  po: PurchaseOrder;
  lineItems: PurchaseOrderLineItem[];
}

export function usePurchaseOrders() {
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Cache of expanded line items per PO id
  const [lineItemsCache, setLineItemsCache] = useState<Record<string, PurchaseOrderLineItem[]>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/purchase-orders');
      if (!res.ok) throw new Error('Failed to load purchase orders');
      const data = await res.json();
      const list: PurchaseOrder[] = Array.isArray(data) ? data : (Array.isArray(data.data) ? data.data : []);
      setOrders(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchLineItems = useCallback(async (poId: string): Promise<PurchaseOrderLineItem[]> => {
    if (lineItemsCache[poId]) return lineItemsCache[poId];
    try {
      const res = await fetch(`/api/purchase-orders/${poId}`);
      if (!res.ok) return [];
      const data = await res.json();
      const items: PurchaseOrderLineItem[] = Array.isArray(data.lineItems) ? data.lineItems : (Array.isArray(data.data?.lineItems) ? data.data.lineItems : []);
      setLineItemsCache(prev => ({ ...prev, [poId]: items }));
      return items;
    } catch {
      return [];
    }
  }, [lineItemsCache]);

  const refreshLineItems = useCallback(async (poId: string): Promise<PurchaseOrderLineItem[]> => {
    try {
      const res = await fetch(`/api/purchase-orders/${poId}`);
      if (!res.ok) return [];
      const data = await res.json();
      const items: PurchaseOrderLineItem[] = Array.isArray(data.lineItems) ? data.lineItems : (Array.isArray(data.data?.lineItems) ? data.data.lineItems : []);
      setLineItemsCache(prev => ({ ...prev, [poId]: items }));
      return items;
    } catch {
      return [];
    }
  }, []);

  const approve = useCallback(async (poId: string, lineItemId: string, quantityReceived: number): Promise<boolean> => {
    try {
      const res = await fetch('/api/purchase-orders/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ poId, lineItemId, quantityReceived }),
      });
      if (!res.ok) return false;
      // Invalidate cache so next fetch is fresh
      setLineItemsCache(prev => {
        const next = { ...prev };
        delete next[poId];
        return next;
      });
      return true;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { orders, loading, error, refresh, fetchLineItems, refreshLineItems, approve };
}
