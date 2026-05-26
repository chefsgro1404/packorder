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
  const [syncMode, setSyncMode] = useState<"incremental" | "full">("incremental");
  const [syncVendors, setSyncVendors] = useState("");
  const [syncTags, setSyncTags] = useState("");
  const [syncClear, setSyncClear] = useState(false);
  const [syncing, setSyncing] = useState(false);

  if (!open) return null;

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: syncMode,
          vendors: syncVendors.split(",").map((v) => v.trim()).filter(Boolean),
          tags: syncTags.split(",").map((t) => t.trim()).filter(Boolean),
          clearFirst: syncClear,
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
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-sm p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-slate-100 text-base">Sync Products</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mode */}
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">Mode</p>
          <div className="flex rounded-lg overflow-hidden border border-slate-700 text-sm">
            <button
              onClick={() => setSyncMode("incremental")}
              className={`flex-1 py-2.5 transition-colors ${syncMode === "incremental" ? "bg-purple-700 text-white font-medium" : "bg-slate-800 text-slate-400 hover:text-slate-200"}`}
            >
              Update changed
            </button>
            <button
              onClick={() => setSyncMode("full")}
              className={`flex-1 py-2.5 transition-colors ${syncMode === "full" ? "bg-purple-700 text-white font-medium" : "bg-slate-800 text-slate-400 hover:text-slate-200"}`}
            >
              Sync all
            </button>
          </div>
          <p className="text-xs text-slate-500">
            {syncMode === "incremental"
              ? "Only fetches products updated since your last sync."
              : "Fetches all products matching the filters and upserts them."}
          </p>
        </div>

        {/* Vendor filter */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">
            Vendor filter <span className="text-slate-600 normal-case">(optional, comma-separated)</span>
          </label>
          <input
            type="text"
            value={syncVendors}
            onChange={(e) => setSyncVendors(e.target.value)}
            placeholder="e.g. Apple, Samsung"
            className="w-full px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 placeholder-slate-600 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
        </div>

        {/* Tag filter */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">
            Tag filter <span className="text-slate-600 normal-case">(optional, comma-separated)</span>
          </label>
          <input
            type="text"
            value={syncTags}
            onChange={(e) => setSyncTags(e.target.value)}
            placeholder="e.g. seasonal, clearance"
            className="w-full px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 placeholder-slate-600 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
        </div>

        {/* Clear before sync */}
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={syncClear}
            onChange={(e) => setSyncClear(e.target.checked)}
            className="mt-0.5 w-4 h-4 rounded accent-purple-600"
          />
          <div>
            <p className="text-sm text-slate-300">Clear before sync</p>
            <p className="text-xs text-slate-500 mt-0.5">
              Removes all cached variants before re-syncing. Use to remove stale data.
            </p>
          </div>
        </label>

        {formattedLastSync && (
          <p className="text-xs text-slate-500">Last synced: {formattedLastSync}</p>
        )}

        {/* Actions */}
        <div className="flex gap-3 pt-1">
          <button
            onClick={onClose}
            disabled={syncing}
            className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 rounded-xl text-sm font-medium text-slate-300 transition-colors"
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
