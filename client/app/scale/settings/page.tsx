'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  RefreshCw,
  Plus,
  Trash2,
  Check,
  AlertCircle,
  Clock,
  Webhook,
  Tag,
  Type,
} from 'lucide-react';

interface TextMapping {
  phrase: string;
  abbreviation: string;
}

interface SyncSettings {
  autoSyncEnabled: boolean;
  autoSyncVendors: string;
  autoSyncTags: string;
  lastSyncedAt: string | null;
  lastSyncVendors: string;
  lastSyncTags: string;
}

export default function ScaleSettingsPage() {
  const router = useRouter();

  // ── Text mappings ────────────────────────────────────────────────────────
  const [mappings, setMappings] = useState<TextMapping[]>([]);
  const [mappingsLoading, setMappingsLoading] = useState(true);
  const [newPhrase, setNewPhrase] = useState('');
  const [newAbbr, setNewAbbr] = useState('');
  const [mappingsSaving, setMappingsSaving] = useState(false);
  const [mappingsError, setMappingsError] = useState<string | null>(null);
  const [deletingPhrase, setDeletingPhrase] = useState<string | null>(null);

  // ── Auto-sync settings ───────────────────────────────────────────────────
  const [syncSettings, setSyncSettings] = useState<SyncSettings>({
    autoSyncEnabled: false,
    autoSyncVendors: '',
    autoSyncTags: '',
    lastSyncedAt: null,
    lastSyncVendors: '',
    lastSyncTags: '',
  });
  const [syncLoading, setSyncLoading] = useState(true);
  const [syncSaving, setSyncSaving] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncSaved, setSyncSaved] = useState(false);

  const fetchMappings = useCallback(async () => {
    setMappingsLoading(true);
    try {
      const res = await fetch('/api/scale/text-mappings');
      const data = await res.json();
      setMappings(data.mappings ?? []);
    } catch {
      setMappingsError('Failed to load mappings');
    } finally {
      setMappingsLoading(false);
    }
  }, []);

  const fetchSyncSettings = useCallback(async () => {
    setSyncLoading(true);
    try {
      const res = await fetch('/api/sync/settings');
      const data = await res.json();
      setSyncSettings(data);
    } catch {
      setSyncError('Failed to load sync settings');
    } finally {
      setSyncLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMappings();
    fetchSyncSettings();
  }, [fetchMappings, fetchSyncSettings]);

  const handleAddMapping = async () => {
    if (!newPhrase.trim() || !newAbbr.trim()) return;
    setMappingsSaving(true);
    setMappingsError(null);
    try {
      const res = await fetch('/api/scale/text-mappings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phrase: newPhrase.trim(), abbreviation: newAbbr.trim() }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Save failed');
      }
      setNewPhrase('');
      setNewAbbr('');
      await fetchMappings();
    } catch (err) {
      setMappingsError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setMappingsSaving(false);
    }
  };

  const handleDeleteMapping = async (phrase: string) => {
    setDeletingPhrase(phrase);
    try {
      await fetch('/api/scale/text-mappings', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phrase }),
      });
      await fetchMappings();
    } catch {
      setMappingsError('Delete failed');
    } finally {
      setDeletingPhrase(null);
    }
  };

  const handleSaveSyncSettings = async () => {
    setSyncSaving(true);
    setSyncError(null);
    setSyncSaved(false);
    try {
      const res = await fetch('/api/sync/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          autoSyncEnabled: syncSettings.autoSyncEnabled,
          vendors: syncSettings.autoSyncVendors.split(',').map(v => v.trim()).filter(Boolean),
          tags: syncSettings.autoSyncTags.split(',').map(t => t.trim()).filter(Boolean),
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Save failed');
      }
      setSyncSaved(true);
      setTimeout(() => setSyncSaved(false), 3000);
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSyncSaving(false);
    }
  };

  const formattedLastSync = syncSettings.lastSyncedAt
    ? new Date(syncSettings.lastSyncedAt).toLocaleString('en-US', {
        timeZone: 'America/New_York',
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      }) + ' EST'
    : null;

  return (
    <main className="min-h-screen bg-slate-950 pb-safe">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-slate-950/95 backdrop-blur border-b border-slate-800/60 px-4 py-3 flex items-center gap-3">
        <button
          onClick={() => router.push('/scale')}
          className="w-9 h-9 flex items-center justify-center rounded-xl bg-slate-900 hover:bg-slate-800 transition-colors flex-shrink-0"
          aria-label="Back to scale"
        >
          <ArrowLeft className="w-4 h-4 text-slate-400" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-bold text-slate-100 leading-tight">Scale Settings</h1>
          <p className="text-xs text-slate-500 leading-tight">Auto-sync, title mappings &amp; webhook setup</p>
        </div>
      </div>

      <div className="px-4 py-5 flex flex-col gap-5">

        {/* ── Scheduled auto-sync ──────────────────────────────────────────── */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          <div className="px-4 pt-4 pb-2 flex items-center gap-2">
            <Clock className="w-4 h-4 text-blue-400" />
            <h2 className="text-sm font-semibold text-slate-200">Scheduled Auto-Sync</h2>
          </div>
          <div className="px-4 pb-4 flex flex-col gap-3">
            <p className="text-xs text-slate-500">
              Automatically syncs products from Shopify every day at midnight New York time.
              Leave vendors and tags empty to sync everything.
            </p>

            {syncLoading ? (
              <div className="flex items-center gap-2 py-2">
                <RefreshCw className="w-4 h-4 text-slate-600 animate-spin" />
                <span className="text-sm text-slate-500">Loading…</span>
              </div>
            ) : (
              <>
                {syncError && (
                  <div className="flex items-center gap-2 bg-rose-950/50 border border-rose-900 rounded-xl px-3 py-2">
                    <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
                    <p className="text-xs text-rose-300">{syncError}</p>
                  </div>
                )}

                {/* Toggle */}
                <button
                  onClick={() => setSyncSettings(s => ({ ...s, autoSyncEnabled: !s.autoSyncEnabled }))}
                  className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-sm font-medium transition-colors ${
                    syncSettings.autoSyncEnabled
                      ? 'bg-blue-950/40 border-blue-800 text-blue-300'
                      : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <span className={`w-11 h-6 rounded-full relative transition-colors shrink-0 ${syncSettings.autoSyncEnabled ? 'bg-blue-500' : 'bg-slate-700'}`}>
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${syncSettings.autoSyncEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
                  </span>
                  {syncSettings.autoSyncEnabled ? 'Auto-sync enabled — runs nightly at midnight NY' : 'Auto-sync disabled'}
                </button>

                <div>
                  <label className="block text-xs text-slate-400 mb-1 font-medium uppercase tracking-wide">
                    Vendors <span className="text-slate-600 normal-case">(optional, comma-separated)</span>
                  </label>
                  <input
                    type="text"
                    value={syncSettings.autoSyncVendors}
                    onChange={e => setSyncSettings(s => ({ ...s, autoSyncVendors: e.target.value }))}
                    placeholder="e.g. Green Valley, Farm Fresh"
                    className="w-full px-3 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs text-slate-400 mb-1 font-medium uppercase tracking-wide">
                    Tags <span className="text-slate-600 normal-case">(optional, comma-separated)</span>
                  </label>
                  <input
                    type="text"
                    value={syncSettings.autoSyncTags}
                    onChange={e => setSyncSettings(s => ({ ...s, autoSyncTags: e.target.value }))}
                    placeholder="e.g. packing, scale"
                    className="w-full px-3 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {formattedLastSync && (
                  <p className="text-xs text-slate-500">Last sync: {formattedLastSync}
                    {syncSettings.lastSyncVendors && <> · Vendors: {syncSettings.lastSyncVendors}</>}
                    {syncSettings.lastSyncTags    && <> · Tags: {syncSettings.lastSyncTags}</>}
                  </p>
                )}

                <button
                  onClick={handleSaveSyncSettings}
                  disabled={syncSaving}
                  className="w-full h-11 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-xl text-sm font-bold transition-all"
                >
                  {syncSaving ? (
                    <><RefreshCw className="w-4 h-4 animate-spin" /> Saving…</>
                  ) : syncSaved ? (
                    <><Check className="w-4 h-4" /> Saved</>
                  ) : (
                    'Save Auto-Sync Settings'
                  )}
                </button>
              </>
            )}
          </div>
        </div>

        {/* ── Variant title abbreviations ──────────────────────────────────── */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          <div className="px-4 pt-4 pb-2 flex items-center gap-2">
            <Type className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-semibold text-slate-200">Title Abbreviations</h2>
          </div>
          <div className="px-4 pb-4 flex flex-col gap-3">
            <p className="text-xs text-slate-500">
              Automatically shorten phrases in product and variant titles on printed labels and QR codes.
              Matching is case-insensitive.
            </p>

            {mappingsError && (
              <div className="flex items-center gap-2 bg-rose-950/50 border border-rose-900 rounded-xl px-3 py-2">
                <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
                <p className="text-xs text-rose-300">{mappingsError}</p>
              </div>
            )}

            {/* Add new mapping */}
            <div className="flex gap-2">
              <input
                type="text"
                value={newPhrase}
                onChange={e => setNewPhrase(e.target.value)}
                placeholder="Phrase (e.g. ready to cook, cut and clean)"
                className="flex-1 min-w-0 px-3 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                onKeyDown={e => { if (e.key === 'Enter') handleAddMapping(); }}
              />
              <input
                type="text"
                value={newAbbr}
                onChange={e => setNewAbbr(e.target.value)}
                placeholder="Short (e.g. RC)"
                className="w-24 px-3 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                onKeyDown={e => { if (e.key === 'Enter') handleAddMapping(); }}
              />
              <button
                onClick={handleAddMapping}
                disabled={mappingsSaving || !newPhrase.trim() || !newAbbr.trim()}
                className="w-10 h-10 flex items-center justify-center rounded-xl bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 transition-colors flex-shrink-0"
                aria-label="Add mapping"
              >
                {mappingsSaving ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Plus className="w-4 h-4" />
                )}
              </button>
            </div>

            {/* Existing mappings */}
            {mappingsLoading ? (
              <div className="flex items-center gap-2 py-2">
                <RefreshCw className="w-4 h-4 text-slate-600 animate-spin" />
                <span className="text-sm text-slate-500">Loading…</span>
              </div>
            ) : mappings.length === 0 ? (
              <p className="text-sm text-slate-600 py-2 text-center">No abbreviations yet</p>
            ) : (
              <div className="flex flex-col divide-y divide-slate-800/60">
                {mappings.map(m => (
                  <div key={m.phrase} className="flex items-center gap-3 py-2.5 group">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm text-slate-300 break-all">{m.phrase}</span>
                        <span className="text-slate-600">→</span>
                        <span className="text-sm font-semibold text-emerald-400">{m.abbreviation}</span>
                      </div>
                    </div>
                    <button
                      onClick={() => handleDeleteMapping(m.phrase)}
                      disabled={deletingPhrase === m.phrase}
                      className="opacity-0 group-hover:opacity-100 transition-opacity w-7 h-7 flex items-center justify-center rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-950/30 flex-shrink-0"
                      aria-label={`Delete mapping for "${m.phrase}"`}
                    >
                      {deletingPhrase === m.phrase ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Webhook setup instructions ───────────────────────────────────── */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          <div className="px-4 pt-4 pb-2 flex items-center gap-2">
            <Webhook className="w-4 h-4 text-purple-400" />
            <h2 className="text-sm font-semibold text-slate-200">Shopify Webhooks</h2>
          </div>
          <div className="px-4 pb-4 flex flex-col gap-3">
            <p className="text-xs text-slate-500">
              Register these webhooks in Shopify Admin so products and orders update in real-time
              without needing a manual sync.
            </p>
            <div className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs font-mono text-slate-400 space-y-1.5">
              <p className="text-slate-500 text-[10px] uppercase tracking-widest font-sans">Webhook URL</p>
              <p className="text-slate-200 break-all">https://&#123;your-functions-url&#125;/api/webhooks/shopify</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <p className="text-xs text-slate-500 font-medium">Topics to subscribe:</p>
              {[
                'products/create',
                'products/update',
                'products/delete',
                'orders/create',
                'orders/updated',
                'orders/fulfilled',
                'orders/partially_fulfilled',
                'orders/cancelled',
              ].map(topic => (
                <div key={topic} className="flex items-center gap-2 px-3 py-1.5 bg-slate-800/60 rounded-lg">
                  <Tag className="w-3 h-3 text-slate-500 flex-shrink-0" />
                  <span className="text-xs font-mono text-slate-300">{topic}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-500">
              In Shopify Admin → Settings → Notifications → Webhooks, create one webhook per topic above.
              Set the format to <span className="font-mono text-slate-400">JSON</span>.
              The <span className="font-mono text-slate-400">ShopifyWebhookSecret</span> in Key Vault must match
              the signing secret Shopify shows when creating the first webhook.
            </p>
          </div>
        </div>

      </div>
    </main>
  );
}
