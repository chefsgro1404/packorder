'use client';

import { useCallback, useEffect } from 'react';
import { OperationJob, OperationJobType } from '@/lib/types';
import { getDeviceId, executeJobByType } from '@/lib/operationQueueUtils';

export { getDeviceId, executeJobByType };

export function useOperationQueue() {
  const deviceId = typeof window !== 'undefined' ? getDeviceId() : 'ssr';

  // Enqueue a job BEFORE executing it, then mark complete or failed.
  // If the enqueue itself fails (network down) execution still proceeds — best-effort durability.
  const enqueueAndRun = useCallback(async <T>(
    jobType: OperationJobType,
    payload: object,
    idempotencyKey: string | null,
    executeFn: () => Promise<T>,
  ): Promise<T> => {
    let jobId: string | null = null;
    try {
      const enqRes = await fetch('/api/operations/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobType, payload: JSON.stringify(payload), deviceId, idempotencyKey }),
      });
      if (enqRes.ok) {
        const data = await enqRes.json();
        // Idempotency hit: job already completed, skip re-execution
        if (data?.status === 'completed') return undefined as unknown as T;
        jobId = data?.id ?? null;
      }
    } catch { /* non-fatal — still execute the operation */ }

    try {
      const result = await executeFn();
      if (jobId) {
        fetch(`/api/operations/jobs/${jobId}/complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }).catch(() => {});
      }
      return result;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      if (jobId) {
        fetch(`/api/operations/jobs/${jobId}/fail`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason }),
        }).catch(() => {});
      }
      throw err;
    }
  }, [deviceId]);

  // Retry worker: picks up orphaned queued jobs (jobs the user re-queued from settings
  // after they went dead). Only processes jobs older than 30s to avoid racing with jobs
  // that are currently being executed by enqueueAndRun in the same session.
  useEffect(() => {
    let running = false;
    const poll = setInterval(async () => {
      if (running) return;
      running = true;
      try {
        const res = await fetch('/api/operations/jobs?status=queued');
        if (!res.ok) return;
        const data = await res.json();
        const jobs: OperationJob[] = data?.jobs ?? [];
        const staleThreshold = new Date(Date.now() - 30_000).toISOString();
        const toExecute = jobs.filter(
          j => (!j.deviceId || j.deviceId === deviceId) && j.createdAt < staleThreshold,
        );
        for (const job of toExecute) {
          const claimRes = await fetch(`/api/operations/jobs/${job.id}/claim`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deviceId }),
          });
          if (!claimRes.ok) continue; // Already claimed by another worker or tab
          try {
            await executeJobByType(job.jobType, job.payload);
            await fetch(`/api/operations/jobs/${job.id}/complete`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
            });
          } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            await fetch(`/api/operations/jobs/${job.id}/fail`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ reason }),
            });
          }
        }
      } catch { /* non-fatal */ } finally {
        running = false;
      }
    }, 5_000);
    return () => clearInterval(poll);
  }, [deviceId]);

  return { enqueueAndRun, deviceId };
}
