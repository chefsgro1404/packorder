"use client";

import { useState } from "react";
import { X, RefreshCw } from "lucide-react";

interface Props {
  open: boolean;
  lastSync: string | null;
  onClose: () => void;
  onSynced: (count: number) => void;
  onError: (message: string) => void;
}

export function SyncModal({ open, lastSync, onClose, onSynced, onError }: Props) {
  const [vendors, setVendors] = useState("");
  const [tags, setTags] = useState("");
  const [syncing, setSyncing] = useState(false);

  if (!open) return null;

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendors: vendors.split(",").map((v) => v.trim()).filter(Boolean),
          tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        }),
      });
      const data = await res.json();
      if (data.ok) {
        onSynced(data.synced);
      } else {
        onError(data.error || "Sync failed");
      }
    } catch {
      onError("Sync failed — check your connection");
    } finally {
      setSyncing(false);
    }
  };

  const formattedLastSync = lastSync
    ? new Date(lastSync).toLocaleString(undefined, {
        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
      })
    : null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-2xl w-full max-w-sm p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-[var(--text-primary)] text-base">Sync Products</h2>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-xs text-[var(--text-muted)]">
          Clears the product cache and re-syncs fresh data from Shopify.
          Leave filters empty to sync everything.
        </p>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">
            Vendor <span className="text-[var(--text-muted)] normal-case">(optional, comma-separated)</span>
          </label>
          <input
            type="text"
            value={vendors}
            onChange={(e) => setVendors(e.target.value)}
            placeholder="e.g. Apple, Samsung"
            className="w-full px-3 py-2.5 bg-[var(--bg-page)] border border-[var(--border-color)] rounded-lg text-[var(--text-primary)] placeholder:text-[var(--text-muted)] text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">
            Tag <span className="text-[var(--text-muted)] normal-case">(optional, comma-separated)</span>
          </label>
          <input
            type="text"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="e.g. seasonal, clearance"
            className="w-full px-3 py-2.5 bg-[var(--bg-page)] border border-[var(--border-color)] rounded-lg text-[var(--text-primary)] placeholder:text-[var(--text-muted)] text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
        </div>

        {formattedLastSync && (
          <p className="text-xs text-[var(--text-muted)]">Last synced: {formattedLastSync}</p>
        )}

        <div className="flex gap-3 pt-1">
          <button
            onClick={onClose}
            disabled={syncing}
            className="flex-1 py-3 bg-[var(--bg-elevated)] hover:bg-[var(--bg-input)] rounded-xl text-sm font-medium text-[var(--text-secondary)] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex-1 py-3 bg-purple-700 hover:bg-purple-600 disabled:opacity-50 rounded-xl text-sm font-bold text-white transition-colors flex items-center justify-center gap-2"
          >
            {syncing ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                Syncing…
              </>
            ) : (
              "Sync now"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
