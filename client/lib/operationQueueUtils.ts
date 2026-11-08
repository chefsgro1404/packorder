const DEVICE_KEY = 'shipScanDeviceId';

export function getDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = `dev-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return 'unknown';
  }
}

// Re-execute a queued operation job from its stored payload string.
// Called by the retry worker when a user re-queues a dead job from settings.
export async function executeJobByType(jobType: string, payloadStr: string): Promise<void> {
  switch (jobType) {
    case 'log-label': {
      const res = await fetch('/api/scale/print-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payloadStr,
      });
      if (!res.ok) throw new Error(`print-log ${res.status}`);
      break;
    }
    case 'adjust-inventory': {
      const res = await fetch('/api/scale/inventory-adjust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payloadStr,
      });
      if (!res.ok) throw new Error(`inventory-adjust ${res.status}`);
      break;
    }
    case 'approve-line-item': {
      const res = await fetch('/api/purchase-orders/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payloadStr,
      });
      if (!res.ok) throw new Error(`approve-line-item ${res.status}`);
      break;
    }
    default:
      throw new Error(`Unknown operation job type: ${jobType}`);
  }
}
