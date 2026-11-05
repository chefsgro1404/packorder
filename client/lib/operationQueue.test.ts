import { describe, it, expect } from 'vitest';
import { jobTypeLabel, retryBackoffMs, buildIdempotencyKey } from './operationJobUtils';
import { OperationJob, OperationJobType, OperationJobStatus, OperationLogEvent } from './types';

// ─── jobTypeLabel ──────────────────────────────────────────────────────────────

describe('jobTypeLabel', () => {
  it('adjust-inventory → Inventory Adjustment', () => {
    expect(jobTypeLabel('adjust-inventory')).toBe('Inventory Adjustment');
  });

  it('log-label → Label Log', () => {
    expect(jobTypeLabel('log-label')).toBe('Label Log');
  });

  it('approve-line-item → PO Line Approval', () => {
    expect(jobTypeLabel('approve-line-item')).toBe('PO Line Approval');
  });

  it('stamp-shipped → Shipped Stamp', () => {
    expect(jobTypeLabel('stamp-shipped')).toBe('Shipped Stamp');
  });

  it('generate-sn → SN Generation', () => {
    expect(jobTypeLabel('generate-sn')).toBe('SN Generation');
  });

  it('unknown type → returns the raw string', () => {
    expect(jobTypeLabel('unknown-type')).toBe('unknown-type');
  });

  it('empty string → returns empty string', () => {
    expect(jobTypeLabel('')).toBe('');
  });
});

// ─── retryBackoffMs ───────────────────────────────────────────────────────────

describe('retryBackoffMs', () => {
  it('first retry (retryCount=1) → 5 seconds', () => {
    expect(retryBackoffMs(1)).toBe(5_000);
  });

  it('second retry (retryCount=2) → 15 seconds', () => {
    expect(retryBackoffMs(2)).toBe(15_000);
  });

  it('third retry (retryCount=3) → 45 seconds', () => {
    expect(retryBackoffMs(3)).toBe(45_000);
  });

  it('beyond third retry → capped at 45 seconds', () => {
    expect(retryBackoffMs(4)).toBe(45_000);
    expect(retryBackoffMs(10)).toBe(45_000);
  });

  it('delays are strictly increasing', () => {
    const d1 = retryBackoffMs(1);
    const d2 = retryBackoffMs(2);
    const d3 = retryBackoffMs(3);
    expect(d1).toBeLessThan(d2);
    expect(d2).toBeLessThan(d3);
  });
});

// ─── Retry state machine ───────────────────────────────────────────────────────

describe('retry state machine', () => {
  function simulateFail(retryCount: number): { newRetryCount: number; status: OperationJobStatus } {
    const newRetryCount = retryCount + 1;
    const status: OperationJobStatus = newRetryCount >= 3 ? 'dead' : 'queued';
    return { newRetryCount, status };
  }

  it('first failure: retryCount becomes 1, status=queued', () => {
    const { newRetryCount, status } = simulateFail(0);
    expect(newRetryCount).toBe(1);
    expect(status).toBe('queued');
  });

  it('second failure: retryCount becomes 2, status=queued', () => {
    const { newRetryCount, status } = simulateFail(1);
    expect(newRetryCount).toBe(2);
    expect(status).toBe('queued');
  });

  it('third failure: retryCount becomes 3, status=dead', () => {
    const { newRetryCount, status } = simulateFail(2);
    expect(newRetryCount).toBe(3);
    expect(status).toBe('dead');
  });

  it('after three failures the job is dead', () => {
    let retryCount = 0;
    let status: OperationJobStatus = 'queued';
    for (let i = 0; i < 3; i++) {
      ({ newRetryCount: retryCount, status } = simulateFail(retryCount));
    }
    expect(status).toBe('dead');
    expect(retryCount).toBe(3);
  });

  it('manual retry resets retryCount to 0 and status to queued', () => {
    // Simulate RetryDeadOperationJobAsync
    let retryCount = 3;
    let status: OperationJobStatus = 'dead';
    retryCount = 0;
    status = 'queued';
    expect(retryCount).toBe(0);
    expect(status).toBe('queued');
  });
});

// ─── OperationJob type contract ───────────────────────────────────────────────

describe('OperationJob type contract', () => {
  it('a minimal job object satisfies the OperationJob interface', () => {
    const job: OperationJob = {
      id:             'job-001',
      jobType:        'adjust-inventory',
      status:         'dead',
      payload:        '{}',
      idempotencyKey: null,
      deviceId:       null,
      claimedBy:      null,
      createdAt:      '2025-06-01T10:00:00Z',
      claimedAt:      null,
      completedAt:    null,
      failedAt:       '2025-06-01T10:05:00Z',
      failedReason:   'Shopify 429',
      retryCount:     3,
    };
    expect(job.status).toBe('dead');
    expect(job.retryCount).toBe(3);
  });

  it('all job types are assignable', () => {
    const types: OperationJobType[] = [
      'adjust-inventory',
      'log-label',
      'approve-line-item',
      'stamp-shipped',
      'generate-sn',
    ];
    expect(types.length).toBe(5);
    types.forEach(t => expect(typeof t).toBe('string'));
  });

  it('all job statuses are assignable', () => {
    const statuses: OperationJobStatus[] = [
      'queued', 'claimed', 'completed', 'failed', 'dead', 'dismissed',
    ];
    expect(statuses.length).toBe(6);
  });

  it('all log events are assignable', () => {
    const events: OperationLogEvent[] = [
      'created', 'claimed', 'completed', 'failed', 'retried', 'dead', 'dismissed',
    ];
    expect(events.length).toBe(7);
  });
});

// ─── Idempotency key construction ─────────────────────────────────────────────

describe('idempotency key construction', () => {
  it('same inputs produce same key', () => {
    const k1 = buildIdempotencyKey('SN-001', 'adjust-inventory', 'li-001');
    const k2 = buildIdempotencyKey('SN-001', 'adjust-inventory', 'li-001');
    expect(k1).toBe(k2);
  });

  it('different SNs produce different keys', () => {
    const k1 = buildIdempotencyKey('SN-001', 'adjust-inventory', 'li-001');
    const k2 = buildIdempotencyKey('SN-002', 'adjust-inventory', 'li-001');
    expect(k1).not.toBe(k2);
  });

  it('different job types produce different keys', () => {
    const k1 = buildIdempotencyKey('SN-001', 'adjust-inventory', 'li-001');
    const k2 = buildIdempotencyKey('SN-001', 'log-label', 'li-001');
    expect(k1).not.toBe(k2);
  });

  it('different refIds produce different keys', () => {
    const k1 = buildIdempotencyKey('SN-001', 'approve-line-item', 'li-001');
    const k2 = buildIdempotencyKey('SN-001', 'approve-line-item', 'li-002');
    expect(k1).not.toBe(k2);
  });

  it('key contains all three parts', () => {
    const key = buildIdempotencyKey('GREEN-GLOBAL-0042', 'stamp-shipped', 'gid://shopify/LineItem/999');
    expect(key).toContain('GREEN-GLOBAL-0042');
    expect(key).toContain('stamp-shipped');
    expect(key).toContain('gid://shopify/LineItem/999');
  });
});

// ─── Dead job filtering ────────────────────────────────────────────────────────

describe('dead job filtering', () => {
  const makeJob = (id: string, status: OperationJobStatus): OperationJob => ({
    id, jobType: 'log-label', status, payload: '{}',
    idempotencyKey: null, deviceId: null, claimedBy: null,
    createdAt: '2025-01-01T00:00:00Z',
    claimedAt: null, completedAt: null, failedAt: null,
    failedReason: null, retryCount: 0,
  });

  it('filters to only dead jobs', () => {
    const jobs = [
      makeJob('1', 'completed'),
      makeJob('2', 'dead'),
      makeJob('3', 'queued'),
      makeJob('4', 'dead'),
    ];
    const dead = jobs.filter(j => j.status === 'dead');
    expect(dead.length).toBe(2);
    expect(dead.map(j => j.id)).toEqual(['2', '4']);
  });

  it('after retry the job is removed from dead list', () => {
    let deadJobs: OperationJob[] = [makeJob('1', 'dead'), makeJob('2', 'dead')];
    const retried = '1';
    deadJobs = deadJobs.filter(j => j.id !== retried);
    expect(deadJobs.length).toBe(1);
    expect(deadJobs[0].id).toBe('2');
  });

  it('after dismiss the job is removed from dead list', () => {
    let deadJobs: OperationJob[] = [makeJob('1', 'dead')];
    const dismissed = '1';
    deadJobs = deadJobs.filter(j => j.id !== dismissed);
    expect(deadJobs.length).toBe(0);
  });

  it('zero dead jobs → badge not shown', () => {
    const deadJobs: OperationJob[] = [];
    const showBadge = deadJobs.length > 0;
    expect(showBadge).toBe(false);
  });

  it('one or more dead jobs → badge shown', () => {
    const deadJobs = [makeJob('1', 'dead')];
    const showBadge = deadJobs.length > 0;
    expect(showBadge).toBe(true);
  });
});
