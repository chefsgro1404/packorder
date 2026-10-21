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
  Printer,
  Layers,
  Building2,
  X,
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

interface FullSyncStage {
  stage: string;
  count: number;
  ok: boolean;
  error?: string;
}

interface FullSyncResult {
  ok: boolean;
  syncedAt: string;
  stages: FullSyncStage[];
}

interface Vendor {
  id: string;
  vendorName: string;
}

interface WebhookResult {
  registered: number;
  alreadyRegistered: number;
  errors: number;
  results: { topic: string; status: string; error?: string }[];
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

  // ── Printer device ───────────────────────────────────────────────────────
  const [isPrinterDevice, setIsPrinterDevice] = useState(false);

  useEffect(() => {
    try {
      setIsPrinterDevice(localStorage.getItem('shipScanPrinterDevice') === 'true');
    } catch {}
  }, []);

  const handleTogglePrinterDevice = (enabled: boolean) => {
    try {
      localStorage.setItem('shipScanPrinterDevice', enabled ? 'true' : 'false');
    } catch {}
    setIsPrinterDevice(enabled);
  };

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

  // ── Full sync ────────────────────────────────────────────────────────────
  const [fullSyncing, setFullSyncing] = useState(false);
  const [fullSyncResult, setFullSyncResult] = useState<FullSyncResult | null>(null);
  const [fullSyncError, setFullSyncError] = useState<string | null>(null);

  // ── Vendors ─────────────────────────────────────────────────────────────
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorsLoading, setVendorsLoading] = useState(true);
  const [vendorError, setVendorError] = useState<string | null>(null);
  const [newVendorName, setNewVendorName] = useState('');
  const [vendorSaving, setVendorSaving] = useState(false);
  const [deletingVendorId, setDeletingVendorId] = useState<string | null>(null);

  // ── Webhook registration ─────────────────────────────────────────────────
  const [webhookCallbackUrl, setWebhookCallbackUrl] = useState('');
  const [webhookRegistering, setWebhookRegistering] = useState(false);
  const [webhookResult, setWebhookResult] = useState<WebhookResult | null>(null);
  const [webhookError, setWebhookError] = useState<string | null>(null);

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

  const fetchVendors = useCallback(async () => {
    setVendorsLoading(true);
    try {
      const res = await fetch('/api/vendors');
      const data = await res.json();
      setVendors(data.vendors ?? []);
    } catch {
      setVendorError('Failed to load vendors');
    } finally {
      setVendorsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMappings();
    fetchSyncSettings();
    fetchVendors();
  }, [fetchMappings, fetchSyncSettings, fetchVendors]);

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

  const handleFullSync = async () => {
    setFullSyncing(true);
    setFullSyncResult(null);
    setFullSyncError(null);
    try {
      const res = await fetch('/api/sync/full', { method: 'POST' });
      let data: unknown;
      try {
        data = await res.json();
      } catch {
        // SWA imposes a ~30s timeout on API routes; if sync runs long, SWA drops the
        // connection and returns a non-JSON error. The sync likely completed in the
        // background — reload after a minute to verify.
        throw new Error('Sync is taking longer than the browser can wait. It may still be running — reload this page in a minute to check the last-synced time.');
      }
      if (!res.ok) throw new Error((data as { error?: string })?.error || 'Full sync failed');
      setFullSyncResult(data as FullSyncResult);
    } catch (err) {
      setFullSyncError(err instanceof Error ? err.message : 'Full sync failed');
    } finally {
      setFullSyncing(false);
    }
  };

  const handleAddVendor = async () => {
    if (!newVendorName.trim()) return;
    setVendorSaving(true);
    setVendorError(null);
    try {
      const res = await fetch('/api/vendors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vendorName: newVendorName.trim() }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Save failed');
      }
      setNewVendorName('');
      await fetchVendors();
    } catch (err) {
      setVendorError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setVendorSaving(false);
    }
  };

  const handleDeleteVendor = async (id: string) => {
    setDeletingVendorId(id);
    setVendorError(null);
    try {
      await fetch(`/api/vendors/${id}`, { method: 'DELETE' });
      await fetchVendors();
    } catch {
      setVendorError('Delete failed');
    } finally {
      setDeletingVendorId(null);
    }
  };

  const handleRegisterWebhooks = async () => {
    if (!webhookCallbackUrl.trim()) return;
    setWebhookRegistering(true);
    setWebhookResult(null);
    setWebhookError(null);
    try {
      const res = await fetch('/api/webhooks/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callbackBaseUrl: webhookCallbackUrl.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Registration failed');
      setWebhookResult(data);
    } catch (err) {
      setWebhookError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setWebhookRegistering(false);
    }
  };

  const formattedLastSync = syncSettings.lastSyncedAt
    ? new Date(syncSettings.lastSyncedAt).toLocaleString('en-US', {
        timeZone: 'America/New_York',
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      }) + ' EST'
    : null;

  const stageName = (s: string) => ({
    products: 'Products & variants',
    purchaseOrders: 'Purchase orders',
    barcodeBackfill: 'Barcode ↔ PO backfill',
    snCounters: 'SN counter reconciliation',
  }[s] ?? s);

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
          <p className="text-xs text-slate-500 leading-tight">Sync, vendors, webhooks &amp; device setup</p>
        </div>
      </div>

      <div className="px-4 py-5 flex flex-col gap-5">

        {/* ── Full Sync ─────────────────────────────────────────────────────── */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          <div className="px-4 pt-4 pb-2 flex items-center gap-2">
            <Layers className="w-4 h-4 text-indigo-400" />
            <h2 className="text-sm font-semibold text-slate-200">Full Sync</h2>
          </div>
          <div className="px-4 pb-4 flex flex-col gap-3">
            <p className="text-xs text-slate-500">
              Runs all four sync stages in order: products &amp; variants → purchase orders → barcode ↔ PO backfill → SN counter reconciliation.
              Safe to run at any time — existing approval state and received quantities are preserved.
            </p>

            {fullSyncError && (
              <div className="flex items-center gap-2 bg-rose-950/50 border border-rose-900 rounded-xl px-3 py-2">
                <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
                <p className="text-xs text-rose-300">{fullSyncError}</p>
              </div>
            )}

            {fullSyncResult && (
              <div className={`border rounded-xl px-3 py-2.5 flex flex-col gap-1.5 ${
                fullSyncResult.ok ? 'bg-emerald-950/40 border-emerald-900' : 'bg-amber-950/40 border-amber-900'
              }`}>
                <p className={`text-xs font-semibold ${fullSyncResult.ok ? 'text-emerald-300' : 'text-amber-300'}`}>
                  {fullSyncResult.ok ? 'Sync complete' : 'Sync completed with errors'}
                </p>
                {fullSyncResult.stages.map(s => (
                  <div key={s.stage} className="flex items-center gap-2 text-xs">
                    {s.ok
                      ? <Check className="w-3 h-3 text-emerald-400 flex-shrink-0" />
                      : <X className="w-3 h-3 text-rose-400 flex-shrink-0" />
                    }
                    <span className="text-slate-300">{stageName(s.stage)}</span>
                    {s.ok
                      ? <span className="text-slate-500 ml-auto">{s.count}</span>
                      : <span className="text-rose-400 ml-auto truncate max-w-[140px]">{s.error}</span>
                    }
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={handleFullSync}
              disabled={fullSyncing}
              className="w-full h-11 flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-xl text-sm font-bold transition-all"
            >
              {fullSyncing ? (
                <><RefreshCw className="w-4 h-4 animate-spin" /> Syncing…</>
              ) : (
                <><RefreshCw className="w-4 h-4" /> Run Full Sync Now</>
              )}
            </button>
          </div>
        </div>

        {/* ── Scheduled auto-sync ──────────────────────────────────────────── */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          <div className="px-4 pt-4 pb-2 flex items-center gap-2">
            <Clock className="w-4 h-4 text-blue-400" />
            <h2 className="text-sm font-semibold text-slate-200">Scheduled Auto-Sync</h2>
          </div>
          <div className="px-4 pb-4 flex flex-col gap-3">
            <p className="text-xs text-slate-500">
              Automatically runs the full sync cascade every day at midnight New York time.
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

        {/* ── Vendor Management ────────────────────────────────────────────── */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          <div className="px-4 pt-4 pb-2 flex items-center gap-2">
            <Building2 className="w-4 h-4 text-teal-400" />
            <h2 className="text-sm font-semibold text-slate-200">Vendors</h2>
          </div>
          <div className="px-4 pb-4 flex flex-col gap-3">
            <p className="text-xs text-slate-500">
              Registered vendors are linked to POs and barcode records for traceability.
            </p>

            {vendorError && (
              <div className="flex items-center gap-2 bg-rose-950/50 border border-rose-900 rounded-xl px-3 py-2">
                <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
                <p className="text-xs text-rose-300">{vendorError}</p>
              </div>
            )}

            <div className="flex gap-2">
              <input
                type="text"
                value={newVendorName}
                onChange={e => setNewVendorName(e.target.value)}
                placeholder="Vendor name…"
                className="flex-1 min-w-0 px-3 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                onKeyDown={e => { if (e.key === 'Enter') handleAddVendor(); }}
              />
              <button
                onClick={handleAddVendor}
                disabled={vendorSaving || !newVendorName.trim()}
                className="w-10 h-10 flex items-center justify-center rounded-xl bg-teal-700 hover:bg-teal-600 disabled:opacity-40 transition-colors flex-shrink-0"
                aria-label="Add vendor"
              >
                {vendorSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              </button>
            </div>

            {vendorsLoading ? (
              <div className="flex items-center gap-2 py-2">
                <RefreshCw className="w-4 h-4 text-slate-600 animate-spin" />
                <span className="text-sm text-slate-500">Loading…</span>
              </div>
            ) : vendors.length === 0 ? (
              <p className="text-sm text-slate-600 py-2 text-center">No vendors yet</p>
            ) : (
              <div className="flex flex-col divide-y divide-slate-800/60">
                {vendors.map(v => (
                  <div key={v.id} className="flex items-center gap-3 py-2.5 group">
                    <Building2 className="w-4 h-4 text-slate-600 flex-shrink-0" />
                    <span className="flex-1 min-w-0 text-sm text-slate-300 truncate">{v.vendorName}</span>
                    <button
                      onClick={() => handleDeleteVendor(v.id)}
                      disabled={deletingVendorId === v.id}
                      className="opacity-0 group-hover:opacity-100 transition-opacity w-7 h-7 flex items-center justify-center rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-950/30 flex-shrink-0"
                      aria-label={`Delete vendor ${v.vendorName}`}
                    >
                      {deletingVendorId === v.id
                        ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        : <Trash2 className="w-3.5 h-3.5" />
                      }
                    </button>
                  </div>
                ))}
              </div>
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

        {/* ── Printer device ───────────────────────────────────────────────── */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          <div className="px-4 pt-4 pb-2 flex items-center gap-2">
            <Printer className="w-4 h-4 text-amber-400" />
            <h2 className="text-sm font-semibold text-slate-200">Printer Device</h2>
          </div>
          <div className="px-4 pb-4 flex flex-col gap-3">
            <p className="text-xs text-slate-500">
              Register this device as the printer. When enabled, this device polls for print jobs
              queued from other devices (e.g. iPad) and executes them using its connected printer.
              Only enable on the device physically connected to the label printer.
            </p>
            <button
              onClick={() => handleTogglePrinterDevice(!isPrinterDevice)}
              className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-sm font-medium transition-colors ${
                isPrinterDevice
                  ? 'bg-amber-950/40 border-amber-800 text-amber-300'
                  : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
              }`}
            >
              <span className={`w-11 h-6 rounded-full relative transition-colors shrink-0 ${isPrinterDevice ? 'bg-amber-500' : 'bg-slate-700'}`}>
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${isPrinterDevice ? 'translate-x-5' : 'translate-x-0'}`} />
              </span>
              {isPrinterDevice ? 'This device is registered as the printer' : 'Register as printer device'}
            </button>
            {isPrinterDevice && (
              <p className="text-xs text-amber-400/70">
                Keep the Scale &amp; Print page open on this device to receive and execute remote print jobs.
              </p>
            )}
          </div>
        </div>

        {/* ── Shopify webhook registration ─────────────────────────────────── */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          <div className="px-4 pt-4 pb-2 flex items-center gap-2">
            <Webhook className="w-4 h-4 text-purple-400" />
            <h2 className="text-sm font-semibold text-slate-200">Shopify Webhooks</h2>
          </div>
          <div className="px-4 pb-4 flex flex-col gap-3">
            <p className="text-xs text-slate-500">
              Auto-register all required webhook subscriptions in Shopify. Enter your Azure Functions base URL below.
              Topics: products/create, products/update, products/delete, orders/*, purchase_orders/*.
            </p>

            {webhookError && (
              <div className="flex items-center gap-2 bg-rose-950/50 border border-rose-900 rounded-xl px-3 py-2">
                <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
                <p className="text-xs text-rose-300">{webhookError}</p>
              </div>
            )}

            {webhookResult && (
              <div className={`border rounded-xl px-3 py-2.5 flex flex-col gap-1 ${
                webhookResult.errors === 0 ? 'bg-emerald-950/40 border-emerald-900' : 'bg-amber-950/40 border-amber-900'
              }`}>
                <p className="text-xs font-semibold text-slate-200">
                  {webhookResult.registered} registered · {webhookResult.alreadyRegistered} already registered
                  {webhookResult.errors > 0 && ` · ${webhookResult.errors} errors`}
                </p>
                {webhookResult.results.filter(r => r.status === 'error').map(r => (
                  <p key={r.topic} className="text-xs text-rose-400 font-mono">{r.topic}: {r.error}</p>
                ))}
              </div>
            )}

            <div>
              <label className="block text-xs text-slate-400 mb-1 font-medium uppercase tracking-wide">
                Functions base URL
              </label>
              <input
                type="text"
                value={webhookCallbackUrl}
                onChange={e => setWebhookCallbackUrl(e.target.value)}
                placeholder="https://your-functions-app.azurewebsites.net"
                className="w-full px-3 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>

            <div className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs font-mono text-slate-400">
              <p className="text-slate-500 text-[10px] uppercase tracking-widest font-sans mb-1">Callback endpoint</p>
              <p className="text-slate-200 break-all">
                {webhookCallbackUrl.trim()
                  ? `${webhookCallbackUrl.trim().replace(/\/$/, '')}/api/webhooks/shopify`
                  : '{base-url}/api/webhooks/shopify'}
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <p className="text-xs text-slate-500 font-medium">Topics to subscribe:</p>
              {[
                'products/create', 'products/update', 'products/delete',
                'orders/create', 'orders/updated', 'orders/fulfilled',
                'orders/cancelled', 'purchase_orders/create', 'purchase_orders/update',
              ].map(topic => (
                <div key={topic} className="flex items-center gap-2 px-3 py-1.5 bg-slate-800/60 rounded-lg">
                  <Tag className="w-3 h-3 text-slate-500 flex-shrink-0" />
                  <span className="text-xs font-mono text-slate-300">{topic}</span>
                </div>
              ))}
            </div>

            <button
              onClick={handleRegisterWebhooks}
              disabled={webhookRegistering || !webhookCallbackUrl.trim()}
              className="w-full h-11 flex items-center justify-center gap-2 bg-purple-700 hover:bg-purple-600 disabled:opacity-50 rounded-xl text-sm font-bold transition-all"
            >
              {webhookRegistering ? (
                <><RefreshCw className="w-4 h-4 animate-spin" /> Registering…</>
              ) : (
                <><Webhook className="w-4 h-4" /> Register All Webhooks</>
              )}
            </button>

            <p className="text-xs text-slate-500">
              The <span className="font-mono text-slate-400">ShopifyWebhookSecret</span> in Key Vault must match
              the signing secret Shopify shows when creating the first webhook.
            </p>
          </div>
        </div>

      </div>
    </main>
  );
}
