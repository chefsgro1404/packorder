'use client';

import { useEffect, useState } from 'react';
import { WifiOff, Package, RefreshCw } from 'lucide-react';

export default function OfflinePage() {
  const [lastSync, setLastSync] = useState<string | null>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem('shipscan_last_sync');
      if (stored) {
        const date = new Date(stored);
        setLastSync(date.toLocaleString('en-US', {
          month: 'short', day: 'numeric',
          hour: 'numeric', minute: '2-digit',
        }));
      }
    } catch { /* localStorage unavailable */ }
  }, []);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6 bg-[var(--bg-page)]">
      <div className="w-full max-w-sm space-y-8 text-center">
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <div className="w-20 h-20 rounded-3xl bg-[var(--bg-card)] border border-[var(--border-color)] flex items-center justify-center">
              <Package className="w-10 h-10 text-[var(--text-muted)]" />
            </div>
            <div className="absolute -bottom-2 -right-2 w-8 h-8 rounded-full bg-[var(--bg-elevated)] border-2 border-[var(--bg-page)] flex items-center justify-center">
              <WifiOff className="w-4 h-4 text-[var(--text-muted)]" />
            </div>
          </div>

          <div className="space-y-1">
            <h1 className="text-xl font-bold text-[var(--text-primary)]">You&apos;re offline</h1>
            <p className="text-sm text-[var(--text-secondary)]">
              ShipScan can&apos;t reach the server right now.
              <br />
              Check your Wi-Fi and try again.
            </p>
          </div>
        </div>

        {lastSync && (
          <p className="text-xs text-[var(--text-muted)]">
            Last synced: {lastSync}
          </p>
        )}

        <button
          onClick={() => window.location.reload()}
          className="w-full flex items-center justify-center gap-2 py-3.5 bg-[var(--accent-color)] hover:opacity-90 rounded-xl font-semibold text-sm transition-opacity"
          style={{ color: '#ffffff' }}
        >
          <RefreshCw className="w-4 h-4" />
          Try again
        </button>
      </div>
    </main>
  );
}
