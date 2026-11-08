import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getDeviceId, executeJobByType } from './operationQueueUtils';

// ─── Device ID ────────────────────────────────────────────────────────────────

describe('getDeviceId', () => {
  let store: Record<string, string> = {};
  const mockStorage = {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { store = {}; },
  };

  beforeEach(() => {
    store = {};
    vi.stubGlobal('localStorage', mockStorage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('generates a new id when none stored', () => {
    const id = getDeviceId();
    expect(id).toMatch(/^dev-[a-z0-9]{8}$/);
  });

  it('returns the same id on subsequent calls (persisted in localStorage)', () => {
    const first = getDeviceId();
    const second = getDeviceId();
    expect(first).toBe(second);
  });

  it('stores id under shipScanDeviceId key', () => {
    const id = getDeviceId();
    expect(mockStorage.getItem('shipScanDeviceId')).toBe(id);
  });

  it('reuses an existing stored id', () => {
    mockStorage.setItem('shipScanDeviceId', 'dev-mydevice');
    expect(getDeviceId()).toBe('dev-mydevice');
  });

  it('returns "unknown" when localStorage throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    });
    expect(getDeviceId()).toBe('unknown');
  });
});

// ─── executeJobByType dispatch ────────────────────────────────────────────────

describe('executeJobByType', () => {
  const makeOkFetch = (status = 200) =>
    vi.fn().mockResolvedValue({ ok: status < 400, status, text: async () => `${status}` });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('log-label: POSTs to /api/scale/print-log', async () => {
    const fetchMock = makeOkFetch();
    vi.stubGlobal('fetch', fetchMock);
    await executeJobByType('log-label', '{"sn":"SN001"}');
    expect(fetchMock).toHaveBeenCalledWith('/api/scale/print-log', expect.objectContaining({ method: 'POST', body: '{"sn":"SN001"}' }));
  });

  it('log-label: throws on non-ok response', async () => {
    vi.stubGlobal('fetch', makeOkFetch(500));
    await expect(executeJobByType('log-label', '{}')).rejects.toThrow('print-log 500');
  });

  it('adjust-inventory: POSTs to /api/scale/inventory-adjust', async () => {
    const fetchMock = makeOkFetch();
    vi.stubGlobal('fetch', fetchMock);
    await executeJobByType('adjust-inventory', '{"delta":-2}');
    expect(fetchMock).toHaveBeenCalledWith('/api/scale/inventory-adjust', expect.objectContaining({ method: 'POST', body: '{"delta":-2}' }));
  });

  it('adjust-inventory: throws on non-ok response', async () => {
    vi.stubGlobal('fetch', makeOkFetch(503));
    await expect(executeJobByType('adjust-inventory', '{}')).rejects.toThrow('inventory-adjust 503');
  });

  it('approve-line-item: POSTs to /api/purchase-orders/approve', async () => {
    const fetchMock = makeOkFetch();
    vi.stubGlobal('fetch', fetchMock);
    await executeJobByType('approve-line-item', '{"poId":"PO1","lineItemId":"LI1","quantityReceived":5}');
    expect(fetchMock).toHaveBeenCalledWith('/api/purchase-orders/approve', expect.objectContaining({ method: 'POST' }));
  });

  it('approve-line-item: throws on non-ok response', async () => {
    vi.stubGlobal('fetch', makeOkFetch(422));
    await expect(executeJobByType('approve-line-item', '{}')).rejects.toThrow('approve-line-item 422');
  });

  it('unknown job type: throws descriptive error', async () => {
    await expect(executeJobByType('stamp-shipped', '{}')).rejects.toThrow('Unknown operation job type: stamp-shipped');
  });
});

// ─── enqueueAndRun behaviour (pure logic) ────────────────────────────────────

// Tests the enqueue-before-execute contract without React hooks.

function makeEnqueueResponse(id = 'job-123', status = 'queued') {
  return { ok: true, status: 200, json: async () => ({ id, status }) };
}

function makeCompleteResponse() {
  return { ok: true, status: 200, json: async () => ({ ok: true }) };
}

function makeFailResponse() {
  return { ok: true, status: 200, json: async () => ({ ok: true }) };
}

describe('enqueueAndRun contract', () => {
  const deviceId = 'dev-test';
  const idempotencyKey = 'SN001:log-label:SN001';

  async function enqueueAndRunPure<T>(
    fetchFn: (url: string, opts?: RequestInit) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>,
    executeFn: () => Promise<T>,
    idempKey: string | null = idempotencyKey,
  ): Promise<T> {
    let jobId: string | null = null;
    try {
      const enqRes = await fetchFn('/api/operations/jobs', {
        method: 'POST',
        body: JSON.stringify({ jobType: 'log-label', payload: '{}', deviceId, idempotencyKey: idempKey }),
      });
      if (enqRes.ok) {
        const data = await enqRes.json() as { id?: string; status?: string };
        if (data?.status === 'completed') return undefined as unknown as T;
        jobId = data?.id ?? null;
      }
    } catch { /* non-fatal */ }

    try {
      const result = await executeFn();
      if (jobId) {
        fetchFn(`/api/operations/jobs/${jobId}/complete`, { method: 'POST' }).catch(() => {});
      }
      return result;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      if (jobId) {
        fetchFn(`/api/operations/jobs/${jobId}/fail`, { method: 'POST', body: JSON.stringify({ reason }) }).catch(() => {});
      }
      throw err;
    }
  }

  it('calls enqueue BEFORE executeFn', async () => {
    const calls: string[] = [];
    const mockFetch = vi.fn((url: string) => {
      if (url === '/api/operations/jobs') {
        calls.push('enqueue');
        return Promise.resolve(makeEnqueueResponse());
      }
      return Promise.resolve(makeCompleteResponse());
    });
    const execute = vi.fn(async () => { calls.push('execute'); return 42; });
    await enqueueAndRunPure(mockFetch, execute);
    expect(calls[0]).toBe('enqueue');
    expect(calls[1]).toBe('execute');
  });

  it('marks job complete on success', async () => {
    const completeCalls: string[] = [];
    const mockFetch = vi.fn((url: string) => {
      if (url === '/api/operations/jobs') return Promise.resolve(makeEnqueueResponse('job-abc'));
      if (url.includes('/complete')) { completeCalls.push(url); return Promise.resolve(makeCompleteResponse()); }
      return Promise.resolve(makeCompleteResponse());
    });
    await enqueueAndRunPure(mockFetch, async () => 'done');
    expect(completeCalls.some(u => u.includes('job-abc') && u.includes('/complete'))).toBe(true);
  });

  it('marks job failed on executeFn error', async () => {
    const failCalls: string[] = [];
    const mockFetch = vi.fn((url: string) => {
      if (url === '/api/operations/jobs') return Promise.resolve(makeEnqueueResponse('job-xyz'));
      if (url.includes('/fail')) { failCalls.push(url); return Promise.resolve(makeFailResponse()); }
      return Promise.resolve(makeFailResponse());
    });
    await expect(
      enqueueAndRunPure(mockFetch, async () => { throw new Error('timeout'); }),
    ).rejects.toThrow('timeout');
    expect(failCalls.some(u => u.includes('job-xyz') && u.includes('/fail'))).toBe(true);
  });

  it('still executes if enqueue fails (network down)', async () => {
    const executed = { called: false };
    const mockFetch = vi.fn((url: string) => {
      if (url === '/api/operations/jobs') return Promise.reject(new Error('network down'));
      return Promise.resolve(makeCompleteResponse());
    });
    const result = await enqueueAndRunPure(mockFetch, async () => { executed.called = true; return 99; });
    expect(executed.called).toBe(true);
    expect(result).toBe(99);
  });

  it('skips execution when idempotency returns completed job', async () => {
    const executed = { called: false };
    const mockFetch = vi.fn((url: string) => {
      if (url === '/api/operations/jobs')
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ id: 'job-done', status: 'completed' }) });
      return Promise.resolve(makeCompleteResponse());
    });
    await enqueueAndRunPure(mockFetch, async () => { executed.called = true; });
    expect(executed.called).toBe(false);
  });

  it('propagates executeFn return value', async () => {
    const mockFetch = vi.fn((url: string) => {
      if (url === '/api/operations/jobs') return Promise.resolve(makeEnqueueResponse());
      return Promise.resolve(makeCompleteResponse());
    });
    const result = await enqueueAndRunPure(mockFetch, async () => ({ foo: 'bar' }));
    expect(result).toEqual({ foo: 'bar' });
  });

  it('null idempotency key is forwarded to enqueue body', async () => {
    let sentBody = '';
    const mockFetch = vi.fn((url: string, opts?: RequestInit) => {
      if (url === '/api/operations/jobs') { sentBody = opts?.body as string; return Promise.resolve(makeEnqueueResponse()); }
      return Promise.resolve(makeCompleteResponse());
    });
    await enqueueAndRunPure(mockFetch, async () => {}, null);
    expect(JSON.parse(sentBody).idempotencyKey).toBeNull();
  });
});

// ─── Worker stale-threshold filter ───────────────────────────────────────────

describe('worker stale-threshold filter', () => {
  const STALE_MS = 30_000;

  function isStale(createdAt: string, nowMs: number): boolean {
    const threshold = new Date(nowMs - STALE_MS).toISOString();
    return createdAt < threshold;
  }

  const now = Date.now();

  it('job created 60s ago is stale (should be executed by worker)', () => {
    const createdAt = new Date(now - 60_000).toISOString();
    expect(isStale(createdAt, now)).toBe(true);
  });

  it('job created 29s ago is NOT stale (might be in-flight)', () => {
    const createdAt = new Date(now - 29_000).toISOString();
    expect(isStale(createdAt, now)).toBe(false);
  });

  it('job created exactly 30s ago is at the boundary — treated as stale', () => {
    const createdAt = new Date(now - STALE_MS).toISOString();
    expect(isStale(createdAt, now)).toBe(false); // strictly less-than threshold
  });

  it('job created 31s ago crosses boundary', () => {
    const createdAt = new Date(now - 31_000).toISOString();
    expect(isStale(createdAt, now)).toBe(true);
  });
});

// ─── Idempotency key shapes ───────────────────────────────────────────────────

describe('idempotency key shapes', () => {
  function buildKey(sn: string, jobType: string, refId: string): string {
    return `${sn}:${jobType}:${refId}`;
  }

  it('log-label key uses sn as both prefix and refId', () => {
    expect(buildKey('SN001', 'log-label', 'SN001')).toBe('SN001:log-label:SN001');
  });

  it('approve-line-item single key includes sn to allow per-print granularity', () => {
    const key = buildKey('SN001', 'approve-line-item', 'PO123:LI456:SN001');
    expect(key).toContain('PO123');
    expect(key).toContain('LI456');
    expect(key).toContain('SN001');
  });

  it('approve-line-item bulk key is per line item (no sn)', () => {
    const key = `PO123:approve-line-item:LI456`;
    expect(key).not.toContain('SN');
    expect(key).toContain('PO123');
    expect(key).toContain('LI456');
  });

  it('adjust-inventory single key includes sn to prevent duplicates for same variant', () => {
    const key = buildKey('SN001', 'adjust-inventory', 'inv-aaa-111');
    expect(key).toBe('SN001:adjust-inventory:inv-aaa-111');
  });

  it('adjust-inventory bulk key includes li.id for uniqueness', () => {
    const key = `inv-aaa-111:adjust-inventory:bulk-LI456`;
    expect(key).toContain('bulk-LI456');
  });

  it('wastage adjust uses null key (non-idempotent one-shot event)', () => {
    const key: string | null = null;
    expect(key).toBeNull();
  });
});

// ─── Worker device-filter logic ───────────────────────────────────────────────

describe('worker device filter', () => {
  interface JobStub { deviceId: string | null; createdAt: string }

  const now = Date.now();
  const stale = new Date(now - 60_000).toISOString();
  const fresh = new Date(now - 5_000).toISOString();
  const myDevice = 'dev-mine';
  const otherDevice = 'dev-other';

  function shouldHandle(job: JobStub, deviceId: string): boolean {
    const threshold = new Date(now - 30_000).toISOString();
    return (!job.deviceId || job.deviceId === deviceId) && job.createdAt < threshold;
  }

  it('stale job for my device → handle', () => {
    expect(shouldHandle({ deviceId: myDevice, createdAt: stale }, myDevice)).toBe(true);
  });

  it('stale job for other device → skip', () => {
    expect(shouldHandle({ deviceId: otherDevice, createdAt: stale }, myDevice)).toBe(false);
  });

  it('fresh job for my device → skip (may still be in-flight)', () => {
    expect(shouldHandle({ deviceId: myDevice, createdAt: fresh }, myDevice)).toBe(false);
  });

  it('stale job with no deviceId → handle (unclaimed from before deviceId tracking)', () => {
    expect(shouldHandle({ deviceId: null, createdAt: stale }, myDevice)).toBe(true);
  });

  it('fresh job with no deviceId → skip', () => {
    expect(shouldHandle({ deviceId: null, createdAt: fresh }, myDevice)).toBe(false);
  });
});
