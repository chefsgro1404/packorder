import { OperationJobType } from './types';

export function jobTypeLabel(jobType: string): string {
  const labels: Record<string, string> = {
    'adjust-inventory':  'Inventory Adjustment',
    'log-label':         'Label Log',
    'approve-line-item': 'PO Line Approval',
    'stamp-shipped':     'Shipped Stamp',
    'generate-sn':       'SN Generation',
  };
  return labels[jobType] ?? jobType;
}

// Exponential backoff delay in ms for a given retry count (1-indexed).
// 1 → 5s, 2 → 15s, 3+ → 45s
export function retryBackoffMs(retryCount: number): number {
  const delays = [5_000, 15_000, 45_000];
  return delays[Math.min(retryCount - 1, delays.length - 1)] ?? 45_000;
}

export function buildIdempotencyKey(
  sn: string, jobType: OperationJobType, refId: string,
): string {
  return `${sn}:${jobType}:${refId}`;
}
