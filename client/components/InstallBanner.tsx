'use client';

import { Download, X } from 'lucide-react';
import { useInstallPrompt } from '@/hooks/useInstallPrompt';

export function InstallBanner() {
  const { showBanner, install, dismiss } = useInstallPrompt();

  if (!showBanner) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 p-4 pb-safe">
      <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-2xl shadow-lg px-4 py-3.5 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-[var(--text-primary)] leading-snug">
            Install ShipScan for a better experience on this device
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={install}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-xl text-xs font-semibold text-white transition-colors"
            aria-label="Install ShipScan"
          >
            <Download className="w-3.5 h-3.5" />
            Install
          </button>
          <button
            onClick={dismiss}
            className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-[var(--bg-input)] transition-colors"
            aria-label="Dismiss install prompt"
          >
            <X className="w-4 h-4 text-[var(--text-muted)]" />
          </button>
        </div>
      </div>
    </div>
  );
}
