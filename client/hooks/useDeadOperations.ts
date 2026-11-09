'use client';

import { useState, useCallback } from 'react';
import { OperationJob } from '@/lib/types';
export { jobTypeLabel, retryBackoffMs, buildIdempotencyKey } from '@/lib/operationJobUtils';

export interface DeadOperationsState {
  deadJobs: OperationJob[];
  loading: boolean;
  error: string | null;
  fetch: () => Promise<void>;
  retry: (jobId: string) => Promise<boolean>;
  dismiss: (jobId: string) => Promise<boolean>;
}

export function useDeadOperations(): DeadOperationsState {
  const [deadJobs, setDeadJobs] = useState<OperationJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await window.fetch('/api/operations/jobs?status=dead');
      if (!res.ok) throw new Error('Failed to load failed operations');
      const data = await res.json();
      setDeadJobs(Array.isArray(data.jobs) ? data.jobs : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
      setDeadJobs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const retry = useCallback(async (jobId: string): Promise<boolean> => {
    try {
      const res = await window.fetch(`/api/operations/jobs/${jobId}/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) return false;
      setDeadJobs(prev => prev.filter(j => j.id !== jobId));
      return true;
    } catch {
      return false;
    }
  }, []);

  const dismiss = useCallback(async (jobId: string): Promise<boolean> => {
    try {
      const res = await window.fetch(`/api/operations/jobs/${jobId}/dismiss`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) return false;
      setDeadJobs(prev => prev.filter(j => j.id !== jobId));
      return true;
    } catch {
      return false;
    }
  }, []);

  return { deadJobs, loading, error, fetch, retry, dismiss };
}

