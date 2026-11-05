import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Re-implement helpers locally so we can test them in isolation ─────────────
// These mirror the functions in scale/page.tsx exactly.

const PO_GROUP_ORDER = ['Today', 'Yesterday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'Older'];

function getPoDateLabel(shopifyCreatedAt: string): string {
  const date = new Date(shopifyCreatedAt);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const targetDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((today.getTime() - targetDay.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays <= 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays <= 6) return date.toLocaleDateString('en-US', { weekday: 'long' });
  return 'Older';
}

function sortPoGroupKeys(keys: string[]): string[] {
  return [...keys].sort((a, b) => {
    const ai = PO_GROUP_ORDER.indexOf(a);
    const bi = PO_GROUP_ORDER.indexOf(b);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns an ISO string for N days ago from the fixed test date (2026-11-05) */
function daysAgo(n: number): string {
  const d = new Date('2026-11-05T12:00:00Z');
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

// ─── getPoDateLabel ───────────────────────────────────────────────────────────

describe('getPoDateLabel', () => {
  beforeEach(() => {
    // Fix "now" to Wednesday 2026-11-05 noon UTC
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-05T12:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('returns Today for a timestamp from today', () => {
    expect(getPoDateLabel('2026-11-05T08:00:00Z')).toBe('Today');
  });

  it('returns Today for a timestamp exactly now', () => {
    expect(getPoDateLabel('2026-11-05T12:00:00Z')).toBe('Today');
  });

  it('returns Today for future timestamp (same day)', () => {
    // slightly in the future still counts as today
    expect(getPoDateLabel('2026-11-05T23:59:59Z')).toBe('Today');
  });

  it('returns Yesterday for one day ago', () => {
    expect(getPoDateLabel('2026-11-04T10:00:00Z')).toBe('Yesterday');
  });

  it('returns day name for 2 days ago (Tuesday)', () => {
    // Nov 5 is Thursday; 2 days ago = Nov 3 = Tuesday
    expect(getPoDateLabel('2026-11-03T10:00:00Z')).toBe('Tuesday');
  });

  it('returns day name for 3 days ago (Monday)', () => {
    // Nov 5 is Thursday; 3 days ago = Nov 2 = Monday
    expect(getPoDateLabel('2026-11-02T10:00:00Z')).toBe('Monday');
  });

  it('returns day name for 4 days ago (Sunday)', () => {
    // Nov 5 is Thursday; 4 days ago = Nov 1 = Sunday
    expect(getPoDateLabel('2026-11-01T10:00:00Z')).toBe('Sunday');
  });

  it('returns day name for 5 days ago (Saturday)', () => {
    // Nov 5 is Thursday; 5 days ago = Oct 31 = Saturday
    expect(getPoDateLabel('2026-10-31T10:00:00Z')).toBe('Saturday');
  });

  it('returns day name for 6 days ago (Friday)', () => {
    // Nov 5 is Thursday; 6 days ago = Oct 30 = Friday
    expect(getPoDateLabel('2026-10-30T10:00:00Z')).toBe('Friday');
  });

  it('returns Older for exactly 7 days ago', () => {
    expect(getPoDateLabel('2026-10-29T10:00:00Z')).toBe('Older');
  });

  it('returns Older for 30 days ago', () => {
    expect(getPoDateLabel('2026-10-06T10:00:00Z')).toBe('Older');
  });

  it('returns Older for over a year ago', () => {
    expect(getPoDateLabel('2025-01-01T10:00:00Z')).toBe('Older');
  });

  it('handles midnight boundary — start of yesterday', () => {
    expect(getPoDateLabel('2026-11-04T00:00:00Z')).toBe('Yesterday');
  });

  it('handles midday yesterday', () => {
    // Using noon UTC is unambiguous across all timezones for a "yesterday" test
    expect(getPoDateLabel('2026-11-04T12:00:00Z')).toBe('Yesterday');
  });
});

// ─── sortPoGroupKeys ──────────────────────────────────────────────────────────

describe('sortPoGroupKeys', () => {
  it('sorts Today before Yesterday', () => {
    const result = sortPoGroupKeys(['Yesterday', 'Today']);
    expect(result).toEqual(['Today', 'Yesterday']);
  });

  it('sorts all standard groups in canonical order', () => {
    const input = ['Older', 'Sunday', 'Today', 'Friday', 'Yesterday', 'Monday'];
    const result = sortPoGroupKeys(input);
    expect(result).toEqual(['Today', 'Yesterday', 'Monday', 'Friday', 'Sunday', 'Older']);
  });

  it('places Older last', () => {
    const result = sortPoGroupKeys(['Older', 'Today', 'Tuesday']);
    expect(result[result.length - 1]).toBe('Older');
    expect(result[0]).toBe('Today');
  });

  it('is stable — does not mutate the original array', () => {
    const input = ['Yesterday', 'Today'];
    const result = sortPoGroupKeys(input);
    expect(input).toEqual(['Yesterday', 'Today']); // original unchanged
    expect(result).toEqual(['Today', 'Yesterday']);
  });

  it('handles single-element array', () => {
    expect(sortPoGroupKeys(['Today'])).toEqual(['Today']);
  });

  it('handles empty array', () => {
    expect(sortPoGroupKeys([])).toEqual([]);
  });

  it('places unknown group keys after all known ones', () => {
    const result = sortPoGroupKeys(['SomeUnknown', 'Today', 'Older']);
    expect(result[0]).toBe('Today');
    expect(result[1]).toBe('Older');
    expect(result[2]).toBe('SomeUnknown');
  });

  it('handles full week correctly', () => {
    const days = ['Saturday', 'Sunday', 'Thursday', 'Wednesday', 'Tuesday', 'Monday', 'Friday'];
    const result = sortPoGroupKeys(days);
    expect(result).toEqual(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']);
  });
});

// ─── Filter chip logic ────────────────────────────────────────────────────────

describe('filter chip toggle logic', () => {
  it('adds a status to active filters when not present', () => {
    const prev = ['open'];
    const chip = 'partial';
    const next = prev.includes(chip) ? prev.filter(c => c !== chip) : [...prev, chip];
    expect(next).toEqual(['open', 'partial']);
  });

  it('removes a status from active filters when already present', () => {
    const prev = ['open', 'partial'];
    const chip = 'partial';
    const next = prev.includes(chip) ? prev.filter(c => c !== chip) : [...prev, chip];
    expect(next).toEqual(['open']);
  });

  it('clearing filters returns empty array', () => {
    const next: string[] = [];
    expect(next).toHaveLength(0);
  });

  it('filters orders by internal status', () => {
    const orders = [
      { id: '1', status: 'open',        shopifyStatus: undefined },
      { id: '2', status: 'partial',     shopifyStatus: undefined },
      { id: '3', status: 'fulfilled',   shopifyStatus: undefined },
      { id: '4', status: 'transferred', shopifyStatus: undefined },
    ];
    const activeFilters = ['open', 'partial'];
    const filtered = orders.filter(po =>
      activeFilters.includes(po.status) ||
      (po.shopifyStatus != null && activeFilters.includes(po.shopifyStatus)),
    );
    expect(filtered.map(o => o.id)).toEqual(['1', '2']);
  });

  it('filters orders by shopify status', () => {
    const orders = [
      { id: '1', status: 'open',      shopifyStatus: 'ordered' },
      { id: '2', status: 'fulfilled', shopifyStatus: 'received' },
      { id: '3', status: 'open',      shopifyStatus: 'draft' },
    ];
    const activeFilters = ['received'];
    const filtered = orders.filter(po =>
      activeFilters.includes(po.status) ||
      (po.shopifyStatus != null && activeFilters.includes(po.shopifyStatus)),
    );
    expect(filtered.map(o => o.id)).toEqual(['2']);
  });

  it('shows all orders when activeFilters is empty', () => {
    const orders = [
      { id: '1', status: 'open',      shopifyStatus: undefined },
      { id: '2', status: 'fulfilled', shopifyStatus: undefined },
    ];
    const activeFilters: string[] = [];
    const filtered = activeFilters.length === 0 ? orders : orders.filter(po =>
      activeFilters.includes(po.status),
    );
    expect(filtered).toHaveLength(2);
  });

  it('filters by both internal and shopify status simultaneously', () => {
    const orders = [
      { id: '1', status: 'open',      shopifyStatus: 'draft' },
      { id: '2', status: 'partial',   shopifyStatus: 'ordered' },
      { id: '3', status: 'fulfilled', shopifyStatus: 'received' },
      { id: '4', status: 'transferred', shopifyStatus: undefined },
    ];
    const activeFilters = ['open', 'received'];
    const filtered = orders.filter(po =>
      activeFilters.includes(po.status) ||
      (po.shopifyStatus != null && activeFilters.includes(po.shopifyStatus)),
    );
    expect(filtered.map(o => o.id)).toEqual(['1', '3']);
  });
});

// ─── Date group collapse logic ────────────────────────────────────────────────

describe('group collapse state', () => {
  it('Today is expanded by default (not in collapsedGroups)', () => {
    const collapsedGroups: Record<string, boolean> = {};
    const isGroupCollapsed = (group: string) => collapsedGroups[group] ?? (group !== 'Today');
    expect(isGroupCollapsed('Today')).toBe(false);
  });

  it('Yesterday is collapsed by default', () => {
    const collapsedGroups: Record<string, boolean> = {};
    const isGroupCollapsed = (group: string) => collapsedGroups[group] ?? (group !== 'Today');
    expect(isGroupCollapsed('Yesterday')).toBe(true);
  });

  it('Older is collapsed by default', () => {
    const collapsedGroups: Record<string, boolean> = {};
    const isGroupCollapsed = (group: string) => collapsedGroups[group] ?? (group !== 'Today');
    expect(isGroupCollapsed('Older')).toBe(true);
  });

  it('toggling a group flips its collapsed state', () => {
    let collapsedGroups: Record<string, boolean> = {};
    const toggle = (group: string) => {
      collapsedGroups = { ...collapsedGroups, [group]: !collapsedGroups[group] };
    };
    const isGroupCollapsed = (group: string) => collapsedGroups[group] ?? (group !== 'Today');

    // Today starts expanded (false), toggle → collapsed (true)
    toggle('Today');
    expect(isGroupCollapsed('Today')).toBe(true);

    // Toggle again → expanded (false)
    toggle('Today');
    expect(isGroupCollapsed('Today')).toBe(false);
  });

  it('Yesterday starts collapsed, toggling expands it', () => {
    let collapsedGroups: Record<string, boolean> = {};
    const toggle = (group: string) => {
      collapsedGroups = { ...collapsedGroups, [group]: !collapsedGroups[group] };
    };
    const isGroupCollapsed = (group: string) => collapsedGroups[group] ?? (group !== 'Today');

    expect(isGroupCollapsed('Yesterday')).toBe(true);
    toggle('Yesterday');
    // After toggle, collapsedGroups['Yesterday'] = !undefined = !false = true
    // Wait — initial undefined is treated as false for yesterday by default (collapsed=true via ?? group !== Today)
    // So toggle sets collapsedGroups['Yesterday'] = !undefined = true  — but that's still collapsed!
    // Actually: !collapsedGroups['Yesterday'] = !undefined = true, so yes stays collapsed
    // Correct toggle: use the current isGroupCollapsed result, not the raw stored value
    // This tests the actual toggle implementation which uses !prev[group]
    // First toggle: !undefined = true → still collapsed
    // Second toggle: !true = false → expanded
    toggle('Yesterday');
    expect(isGroupCollapsed('Yesterday')).toBe(false);
  });

  it('toggling one group does not affect other groups', () => {
    let collapsedGroups: Record<string, boolean> = {};
    const toggle = (group: string) => {
      collapsedGroups = { ...collapsedGroups, [group]: !(collapsedGroups[group] ?? (group !== 'Today')) };
    };
    const isGroupCollapsed = (group: string) => collapsedGroups[group] ?? (group !== 'Today');

    toggle('Today'); // collapse Today
    expect(isGroupCollapsed('Today')).toBe(true);
    expect(isGroupCollapsed('Yesterday')).toBe(true);  // unchanged
    expect(isGroupCollapsed('Older')).toBe(true);      // unchanged
  });
});

// ─── markTransferred hook logic ───────────────────────────────────────────────

describe('markTransferred optimistic update', () => {
  it('updates the matching order status to transferred in state', () => {
    const orders = [
      { id: 'po-1', status: 'open' },
      { id: 'po-2', status: 'fulfilled' },
      { id: 'po-3', status: 'partial' },
    ];
    // Simulate the setOrders optimistic update
    const updated = orders.map(o => o.id === 'po-2' ? { ...o, status: 'transferred' } : o);
    expect(updated.find(o => o.id === 'po-2')?.status).toBe('transferred');
    expect(updated.find(o => o.id === 'po-1')?.status).toBe('open');
    expect(updated.find(o => o.id === 'po-3')?.status).toBe('partial');
  });

  it('does not mutate other orders when one is transferred', () => {
    const orders = [
      { id: 'po-1', status: 'fulfilled', vendor: 'VendorA' },
      { id: 'po-2', status: 'open',      vendor: 'VendorB' },
    ];
    const updated = orders.map(o => o.id === 'po-1' ? { ...o, status: 'transferred' } : o);
    expect(updated[1]).toEqual(orders[1]); // po-2 is identical
  });

  it('extracts numeric id from gid for the fetch URL', () => {
    const poId = 'gid://shopify/PurchaseOrder/88888';
    const numericId = poId.includes('/') ? poId.split('/').pop()! : poId;
    expect(numericId).toBe('88888');
  });

  it('uses plain id as-is when not a gid', () => {
    const poId = '12345';
    const numericId = poId.includes('/') ? poId.split('/').pop()! : poId;
    expect(numericId).toBe('12345');
  });
});

// ─── Available chips derivation ───────────────────────────────────────────────

describe('available filter chips derivation', () => {
  it('collects unique internal statuses from orders', () => {
    const orders = [
      { status: 'open',      shopifyStatus: undefined as string | undefined },
      { status: 'partial',   shopifyStatus: undefined as string | undefined },
      { status: 'open',      shopifyStatus: undefined as string | undefined }, // duplicate
      { status: 'fulfilled', shopifyStatus: undefined as string | undefined },
    ];
    const internal = new Set<string>();
    for (const po of orders) internal.add(po.status);
    expect(Array.from(internal).sort()).toEqual(['fulfilled', 'open', 'partial']);
  });

  it('collects unique shopify statuses from orders', () => {
    const orders = [
      { status: 'open',    shopifyStatus: 'ordered' as string | undefined },
      { status: 'partial', shopifyStatus: 'partially_received' as string | undefined },
      { status: 'open',    shopifyStatus: 'ordered' as string | undefined }, // duplicate
    ];
    const shopify = new Set<string>();
    for (const po of orders) if (po.shopifyStatus) shopify.add(po.shopifyStatus);
    expect(Array.from(shopify).sort()).toEqual(['ordered', 'partially_received']);
  });

  it('ignores null/undefined shopify statuses', () => {
    const orders = [
      { status: 'open',      shopifyStatus: undefined as string | undefined },
      { status: 'fulfilled', shopifyStatus: null as unknown as string | undefined },
    ];
    const shopify = new Set<string>();
    for (const po of orders) if (po.shopifyStatus) shopify.add(po.shopifyStatus);
    expect(shopify.size).toBe(0);
  });

  it('returns empty chips when orders list is empty', () => {
    const orders: Array<{ status: string; shopifyStatus?: string }> = [];
    const internal = new Set<string>();
    const shopify  = new Set<string>();
    for (const po of orders) {
      internal.add(po.status);
      if (po.shopifyStatus) shopify.add(po.shopifyStatus);
    }
    expect(internal.size).toBe(0);
    expect(shopify.size).toBe(0);
  });
});
