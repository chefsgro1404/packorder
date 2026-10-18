'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PrintJob, PrintJobPayload } from '@/lib/types';

const DEVICE_ID_KEY = 'shipScanDeviceId';
const PRINTER_DEVICE_KEY = 'shipScanPrinterDevice';

function getOrCreateDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const id = `dev-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
    localStorage.setItem(DEVICE_ID_KEY, id);
    return id;
  } catch {
    return `dev-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function usePrintQueue() {
  const [isPrinterDevice, setIsPrinterDevice] = useState(false);
  const deviceId = useRef<string>('');

  useEffect(() => {
    deviceId.current = getOrCreateDeviceId();
    try {
      setIsPrinterDevice(localStorage.getItem(PRINTER_DEVICE_KEY) === 'true');
    } catch {}
  }, []);

  const togglePrinterDevice = useCallback((enabled: boolean) => {
    try {
      localStorage.setItem(PRINTER_DEVICE_KEY, enabled ? 'true' : 'false');
    } catch {}
    setIsPrinterDevice(enabled);
  }, []);

  const createJob = useCallback(async (
    payload: PrintJobPayload,
    jobType: 'label' | 'barcode' = 'label'
  ): Promise<PrintJob | null> => {
    try {
      const res = await fetch('/api/print-jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payload: JSON.stringify(payload),
          jobType,
          createdBy: deviceId.current,
        }),
      });
      if (!res.ok) return null;
      return await res.json() as PrintJob;
    } catch {
      return null;
    }
  }, []);

  const getJob = useCallback(async (id: string): Promise<PrintJob | null> => {
    try {
      const res = await fetch(`/api/print-jobs/${id}`);
      if (!res.ok) return null;
      return await res.json() as PrintJob;
    } catch {
      return null;
    }
  }, []);

  const listQueuedJobs = useCallback(async (): Promise<PrintJob[]> => {
    try {
      const res = await fetch('/api/print-jobs?status=queued');
      if (!res.ok) return [];
      const data = await res.json();
      return (data.jobs ?? []) as PrintJob[];
    } catch {
      return [];
    }
  }, []);

  const claimJob = useCallback(async (id: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/print-jobs/${id}/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: deviceId.current }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }, []);

  const completeJob = useCallback(async (id: string): Promise<void> => {
    try {
      await fetch(`/api/print-jobs/${id}/complete`, { method: 'POST' });
    } catch {}
  }, []);

  const failJob = useCallback(async (id: string, reason: string): Promise<void> => {
    try {
      await fetch(`/api/print-jobs/${id}/fail`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
    } catch {}
  }, []);

  return {
    isPrinterDevice,
    deviceId: deviceId.current,
    togglePrinterDevice,
    createJob,
    getJob,
    listQueuedJobs,
    claimJob,
    completeJob,
    failJob,
  };
}
