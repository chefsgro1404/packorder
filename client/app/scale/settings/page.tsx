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
  Scale,
  ShieldAlert,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  Sun,
  Moon,
} from 'lucide-react';
import { useDeadOperations, jobTypeLabel } from '@/hooks/useDeadOperations';
import { useTheme } from '@/hooks/useTheme';

interface WeightRangeRule {
  variantId: string;
  label: string;
  minLbs: number;
  maxLbs: number | null;
}

interface VariantOption {
  variantId: string;
  variantTitle: string;
}

interface WrTierMeta {
  targetSearch: string;
  targetResults: { productId: string; productTitle: string }[];
  targetVariants: VariantOption[];
  targetProductTitle: string;
  searching: boolean;
}

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
  lastSyncStages?: FullSyncStage[] | null;
  poStatusCounts?: Record<string, number> | null;
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

  // ── Theme ────────────────────────────────────────────────────────────────
  const { theme, toggleTheme } = useTheme();

  // ── Failed operations (CRH-271) ──────────────────────────────────────────
  const { deadJobs, loading: deadLoading, error: deadError, fetch: fetchDeadJobs, retry: retryJob, dismiss: dismissJob } = useDeadOperations();
  const [failedOpsOpen, setFailedOpsOpen] = useState(false);
  const [failedOpsActing, setFailedOpsActing] = useState<string | null>(null);

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

  // ── Lot products ─────────────────────────────────────────────────────────
  const [lotProducts, setLotProducts] = useState<{ productId: string; productTitle: string; configuredAt: string }[]>([]);
  const [lotProductsLoading, setLotProductsLoading] = useState(false);
  const [lotProductSearch, setLotProductSearch] = useState('');
  const [lotProductResults, setLotProductResults] = useState<{ productId: string; productTitle: string }[]>([]);
  const [lotProductSearching, setLotProductSearching] = useState(false);
  const [lotProductSaving, setLotProductSaving] = useState(false);
  const [lotProductError, setLotProductError] = useState<string | null>(null);

  // ── Weight ranges ────────────────────────────────────────────────────────
  const [wrProductId, setWrProductId] = useState('');
  const [wrProductSearch, setWrProductSearch] = useState('');
  const [wrProductTitle, setWrProductTitle] = useState('');
  const [wrRules, setWrRules] = useState<WeightRangeRule[]>([]);
  const [wrTierMeta, setWrTierMeta] = useState<WrTierMeta[]>([]);
  const [wrLoading, setWrLoading] = useState(false);
  const [wrSaving, setWrSaving] = useState(false);
  const [wrError, setWrError] = useState<string | null>(null);
  const [wrSaved, setWrSaved] = useState(false);
  const [wrProductResults, setWrProductResults] = useState<{ productId: string; productTitle: string }[]>([]);
  const [wrSearching, setWrSearching] = useState(false);
  const [wrConfiguredProducts, setWrConfiguredProducts] = useState<{ productId: string; productTitle: string; rulesCount: number }[]>([]);
  const [wrConfiguredLoading, setWrConfiguredLoading] = useState(false);

  // ── Webhook registration ─────────────────────────────────────────────────
  const [webhookCallbackUrl, setWebhookCallbackUrl] = useState('');
  const [webhookRegistering, setWebhookRegistering] = useState(false);
  const [webhookResult, setWebhookResult] = useState<WebhookResult | null>(null);
  const [webhookError, setWebhookError] = useState<string | null>(null);
  const [registeredWebhooks, setRegisteredWebhooks] = useState<{ id: string; topic: string; address: string }[]>([]);
  const [webhooksLoading, setWebhooksLoading] = useState(false);
  const [deletingWebhookId, setDeletingWebhookId] = useState<string | null>(null);

  const fetchMappings = useCallback(async () => {
    setMappingsLoading(true);
    try {
      const res = await fetch('/api/scale/text-mappings');
      const data = await res.json();
      setMappings((data.data ?? data).mappings ?? []);
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
      setSyncSettings(data.data ?? data);
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
      const payload = data.data ?? data;
      setVendors(payload.vendors ?? []);
    } catch {
      setVendorError('Failed to load vendors');
    } finally {
      setVendorsLoading(false);
    }
  }, []);

  const fetchConfiguredProducts = useCallback(async () => {
    setWrConfiguredLoading(true);
    try {
      const res = await fetch('/api/scale/weight-ranges');
      if (!res.ok) return;
      const data = await res.json();
      setWrConfiguredProducts(data.products ?? []);
    } catch { /* non-fatal */ } finally {
      setWrConfiguredLoading(false);
    }
  }, []);

  const fetchLotProductList = useCallback(async () => {
    setLotProductsLoading(true);
    try {
      const res = await fetch('/api/scale/lot-products');
      if (!res.ok) return;
      const data = await res.json();
      setLotProducts(data.products ?? []);
    } catch { /* non-fatal */ } finally {
      setLotProductsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMappings();
    fetchSyncSettings();
    fetchVendors();
    fetchConfiguredProducts();
    fetchLotProductList();
    fetchDeadJobs();
  }, [fetchMappings, fetchSyncSettings, fetchVendors, fetchConfiguredProducts, fetchLotProductList, fetchDeadJobs]);

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
      if (!res.ok) throw new Error((data as { error?: string; data?: { error?: string } })?.error || (data as { data?: { error?: string } })?.data?.error || 'Full sync failed');
      setFullSyncResult(((data as { data?: FullSyncResult })?.data ?? data) as FullSyncResult);
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

  const fetchRegisteredWebhooks = useCallback(async () => {
    setWebhooksLoading(true);
    try {
      const res = await fetch('/api/webhooks');
      const data = await res.json();
      if (res.ok) {
        const payload = data.data ?? data;
        setRegisteredWebhooks(payload.webhooks ?? []);
        if (payload.callbackBaseUrl && !webhookCallbackUrl) setWebhookCallbackUrl(payload.callbackBaseUrl);
      }
    } catch {
      // silent
    } finally {
      setWebhooksLoading(false);
    }
  }, [webhookCallbackUrl]);

  const handleDeleteWebhook = async (id: string) => {
    setDeletingWebhookId(id);
    try {
      const res = await fetch(`/api/webhooks/${id}`, { method: 'DELETE' });
      if (res.ok) setRegisteredWebhooks(prev => prev.filter(w => w.id !== id));
    } catch {
      // silent
    } finally {
      setDeletingWebhookId(null);
    }
  };

  const handleRegisterWebhooks = async () => {
    setWebhookRegistering(true);
    setWebhookResult(null);
    setWebhookError(null);
    try {
      const res = await fetch('/api/webhooks/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callbackBaseUrl: webhookCallbackUrl.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.data?.error || 'Registration failed');
      setWebhookResult(data.data ?? data);
      await fetchRegisteredWebhooks();
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

  const handleLotProductSearch = async () => {
    if (!lotProductSearch.trim()) return;
    setLotProductSearching(true);
    setLotProductError(null);
    try {
      const res = await fetch(`/api/products?search=${encodeURIComponent(lotProductSearch.trim())}&pageSize=20`);
      if (!res.ok) throw new Error('Search failed');
      const data = await res.json();
      setLotProductResults(data.products ?? []);
    } catch {
      setLotProductError('Search failed — try again');
    } finally {
      setLotProductSearching(false);
    }
  };

  const handleAddLotProduct = async (productId: string, productTitle: string) => {
    setLotProductSaving(true);
    setLotProductError(null);
    try {
      const res = await fetch('/api/scale/lot-products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, productTitle }),
      });
      if (!res.ok) throw new Error('Failed to save');
      await fetchLotProductList();
      setLotProductResults([]);
      setLotProductSearch('');
    } catch {
      setLotProductError('Failed to save lot product — try again');
    } finally {
      setLotProductSaving(false);
    }
  };

  const handleWrSearch = async () => {
    if (!wrProductSearch.trim()) return;
    setWrSearching(true);
    setWrError(null);
    try {
      const res = await fetch(`/api/products?search=${encodeURIComponent(wrProductSearch.trim())}&pageSize=10`);
      if (!res.ok) throw new Error('Search failed');
      const data = await res.json();
      const products: { productId: string; productTitle: string }[] =
        (data.products ?? data.data?.products ?? []).map((p: { productId?: string; id?: string; productTitle?: string; title?: string }) => ({
          productId:    p.productId ?? p.id ?? '',
          productTitle: p.productTitle ?? p.title ?? '',
        }));
      setWrProductResults(products);
    } catch (e) {
      setWrError(e instanceof Error ? e.message : 'Search failed');
    } finally {
      setWrSearching(false);
    }
  };

  const emptyTierMeta = (): WrTierMeta => ({
    targetSearch: '', targetResults: [], targetVariants: [], targetProductTitle: '', searching: false,
  });

  const handleWrSelectProduct = async (productId: string, productTitle: string) => {
    setWrProductId(productId);
    setWrProductTitle(productTitle);
    setWrProductResults([]);
    setWrLoading(true);
    setWrError(null);
    try {
      const res = await fetch(`/api/scale/weight-ranges?productId=${encodeURIComponent(productId)}`);
      if (!res.ok) throw new Error('Failed to load weight ranges');
      const data = await res.json();
      const rules: WeightRangeRule[] = data.rules ?? [];
      setWrRules(rules);
      // Reverse-lookup each rule's target product so the UI can show its name
      const metas = await Promise.all(rules.map(async (rule): Promise<WrTierMeta> => {
        if (!rule.variantId) return emptyTierMeta();
        try {
          const vRes = await fetch(`/api/scale/products/by-variant?variantId=${encodeURIComponent(rule.variantId)}`);
          if (!vRes.ok) return emptyTierMeta();
          const vData = await vRes.json();
          if (!vData?.found || !vData?.productId) return emptyTierMeta();
          const rangesRes = await fetch(`/api/scale/weight-ranges?productId=${encodeURIComponent(vData.productId)}`);
          const variants: VariantOption[] = rangesRes.ok ? ((await rangesRes.json()).variantOptions ?? []) : [];
          return { ...emptyTierMeta(), targetVariants: variants, targetProductTitle: vData.productTitle ?? '' };
        } catch { return emptyTierMeta(); }
      }));
      setWrTierMeta(metas);
    } catch (e) {
      setWrError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setWrLoading(false);
    }
  };

  const handleWrSave = async () => {
    if (!wrProductId) return;
    setWrSaving(true);
    setWrError(null);
    setWrSaved(false);
    try {
      const res = await fetch('/api/scale/weight-ranges', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: wrProductId, rules: wrRules }),
      });
      if (!res.ok) throw new Error('Failed to save');
      setWrSaved(true);
      setTimeout(() => setWrSaved(false), 2000);
      await fetchConfiguredProducts();
    } catch (e) {
      setWrError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setWrSaving(false);
    }
  };

  const handleWrAddRule = () => {
    setWrRules(prev => [...prev, { variantId: '', label: '', minLbs: 0, maxLbs: null }]);
    setWrTierMeta(prev => [...prev, emptyTierMeta()]);
  };

  const handleWrUpdateRule = (idx: number, field: keyof WeightRangeRule, value: string | number | null) => {
    setWrRules(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  };

  const handleWrRemoveRule = (idx: number) => {
    setWrRules(prev => prev.filter((_, i) => i !== idx));
    setWrTierMeta(prev => prev.filter((_, i) => i !== idx));
  };

  const handleWrTierSearch = async (idx: number, search: string) => {
    setWrTierMeta(prev => prev.map((m, i) => i === idx ? { ...m, targetSearch: search, targetResults: [] } : m));
    if (!search.trim()) return;
    setWrTierMeta(prev => prev.map((m, i) => i === idx ? { ...m, searching: true } : m));
    try {
      const res = await fetch(`/api/products?search=${encodeURIComponent(search.trim())}&pageSize=8`);
      if (!res.ok) throw new Error('Search failed');
      const data = await res.json();
      const results = (data.products ?? []).map((p: { productId?: string; id?: string; productTitle?: string; title?: string }) => ({
        productId: p.productId ?? p.id ?? '',
        productTitle: p.productTitle ?? p.title ?? '',
      }));
      setWrTierMeta(prev => prev.map((m, i) => i === idx ? { ...m, targetResults: results, searching: false } : m));
    } catch {
      setWrTierMeta(prev => prev.map((m, i) => i === idx ? { ...m, searching: false } : m));
    }
  };

  const handleWrTierSelectProduct = async (idx: number, productId: string, productTitle: string) => {
    try {
      const res = await fetch(`/api/scale/weight-ranges?productId=${encodeURIComponent(productId)}`);
      const data = res.ok ? await res.json() : {};
      const variants: VariantOption[] = data.variantOptions ?? [];
      setWrTierMeta(prev => prev.map((m, i) => i === idx
        ? { ...m, targetSearch: '', targetResults: [], targetVariants: variants, targetProductTitle: productTitle }
        : m));
      setWrRules(prev => prev.map((r, i) => {
        if (i !== idx) return r;
        const variantId = variants.length === 1 ? variants[0].variantId : r.variantId;
        return { ...r, variantId, label: r.label || productTitle };
      }));
    } catch { /* non-fatal */ }
  };

  const handleWrTierClear = (idx: number) => {
    setWrTierMeta(prev => prev.map((m, i) => i === idx ? emptyTierMeta() : m));
    setWrRules(prev => prev.map((r, i) => i === idx ? { ...r, variantId: '', label: '' } : r));
  };

  return (
    <main className="min-h-screen bg-[var(--bg-page)] pb-safe">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[var(--bg-page)] backdrop-blur border-b border-[var(--border-color)] px-4 py-3 flex items-center gap-3">
        <button
          onClick={() => router.push('/scale')}
          className="w-9 h-9 flex items-center justify-center rounded-xl bg-[var(--bg-card)] hover:bg-[var(--bg-input)] transition-colors flex-shrink-0"
          aria-label="Back to scale"
        >
          <ArrowLeft className="w-4 h-4 text-[var(--text-muted)]" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-bold text-[var(--text-primary)] leading-tight">Scale Settings</h1>
          <p className="text-xs text-[var(--text-muted)] leading-tight">Sync, vendors, webhooks &amp; device setup</p>
        </div>
      </div>

      <div className="px-4 py-5 flex flex-col gap-5">

        {/* ── Full Sync ─────────────────────────────────────────────────────── */}
        <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-2xl overflow-hidden">
          <div className="px-4 pt-4 pb-2 flex items-center gap-2">
            <Layers className="w-4 h-4 text-indigo-400" />
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Full Sync</h2>
          </div>
          <div className="px-4 pb-4 flex flex-col gap-3">
            <p className="text-xs text-slate-500">
              Runs all four sync stages in order: products &amp; variants → purchase orders → barcode ↔ PO backfill → SN counter reconciliation.
              Safe to run at any time — existing approval state and received quantities are preserved.
            </p>

            {fullSyncError && (
              <div className="flex items-center gap-2 bg-rose-50 border border-rose-200 dark:bg-rose-950/50 dark:border-rose-900 rounded-xl px-3 py-2">
                <AlertCircle className="w-4 h-4 text-rose-500 dark:text-rose-400 flex-shrink-0" />
                <p className="text-xs text-rose-700 dark:text-rose-300">{fullSyncError}</p>
              </div>
            )}

            {fullSyncResult && (
              <div className={`border rounded-xl px-3 py-2.5 flex flex-col gap-1.5 ${
                fullSyncResult.ok ? 'bg-emerald-50 border-emerald-200 dark:bg-emerald-950/40 dark:border-emerald-900' : 'bg-amber-50 border-amber-200 dark:bg-amber-950/40 dark:border-amber-900'
              }`}>
                <p className={`text-xs font-semibold ${fullSyncResult.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}`}>
                  {fullSyncResult.ok ? 'Sync complete' : 'Sync completed with errors'}
                </p>
                {fullSyncResult.stages.map(s => (
                  <div key={s.stage} className="flex items-center gap-2 text-xs">
                    {s.ok
                      ? <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                      : <X className="w-3 h-3 text-rose-500 dark:text-rose-400 flex-shrink-0" />
                    }
                    <span className="text-[var(--text-secondary)]">{stageName(s.stage)}</span>
                    {s.ok
                      ? <span className="text-slate-500 ml-auto">{s.count}</span>
                      : <span className="text-rose-600 dark:text-rose-400 ml-auto truncate max-w-[140px]">{s.error}</span>
                    }
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={handleFullSync}
              disabled={fullSyncing}
              className="w-full h-11 flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-xl text-sm font-bold text-white transition-all"
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
        <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-2xl overflow-hidden">
          <div className="px-4 pt-4 pb-2 flex items-center gap-2">
            <Clock className="w-4 h-4 text-blue-400" />
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Scheduled Auto-Sync</h2>
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
                  <div className="flex items-center gap-2 bg-rose-50 border border-rose-200 dark:bg-rose-950/50 dark:border-rose-900 rounded-xl px-3 py-2">
                    <AlertCircle className="w-4 h-4 text-rose-500 dark:text-rose-400 flex-shrink-0" />
                    <p className="text-xs text-rose-700 dark:text-rose-300">{syncError}</p>
                  </div>
                )}

                <button
                  onClick={() => setSyncSettings(s => ({ ...s, autoSyncEnabled: !s.autoSyncEnabled }))}
                  className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-sm font-medium transition-colors ${
                    syncSettings.autoSyncEnabled
                      ? 'bg-blue-50 border-blue-300 text-blue-800 dark:bg-blue-950/40 dark:border-blue-800 dark:text-blue-300'
                      : 'bg-[var(--bg-input)] border-[var(--border-color)] text-slate-400 hover:text-[var(--text-primary)]'
                  }`}
                >
                  <span className={`w-11 h-6 rounded-full relative transition-colors shrink-0 ${syncSettings.autoSyncEnabled ? 'bg-blue-500' : 'bg-[var(--bg-elevated)]'}`}>
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
                    className="w-full px-3 py-2.5 bg-[var(--bg-page)] border border-[var(--border-color)] rounded-xl text-[var(--text-primary)] placeholder:text-[var(--text-muted)] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                    className="w-full px-3 py-2.5 bg-[var(--bg-page)] border border-[var(--border-color)] rounded-xl text-[var(--text-primary)] placeholder:text-[var(--text-muted)] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {formattedLastSync && (
                  <div className="space-y-1">
                    <p className="text-xs text-slate-500">Last sync: {formattedLastSync}
                      {syncSettings.lastSyncVendors && <> · Vendors: {syncSettings.lastSyncVendors}</>}
                      {syncSettings.lastSyncTags    && <> · Tags: {syncSettings.lastSyncTags}</>}
                    </p>
                    {syncSettings.lastSyncStages && syncSettings.lastSyncStages.length > 0 && (
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                        {syncSettings.lastSyncStages.map(s => (
                          <span key={s.stage} className={`text-xs ${s.ok ? 'text-slate-500' : 'text-rose-600 dark:text-rose-400'}`}>
                            {s.stage}: {s.ok ? s.count : `error — ${s.error ?? 'failed'}`}
                          </span>
                        ))}
                      </div>
                    )}
                    {syncSettings.poStatusCounts && Object.keys(syncSettings.poStatusCounts).length > 0 && (
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                        <span className="text-xs text-slate-600">POs in DB:</span>
                        {Object.entries(syncSettings.poStatusCounts).sort().map(([status, count]) => (
                          <span key={status} className={`text-xs ${status === 'open' || status === 'partial' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500'}`}>
                            {status}: {count}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <button
                  onClick={handleSaveSyncSettings}
                  disabled={syncSaving}
                  className="w-full h-11 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-xl text-sm font-bold text-white transition-all"
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
        <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-2xl overflow-hidden">
          <div className="px-4 pt-4 pb-2 flex items-center gap-2">
            <Building2 className="w-4 h-4 text-teal-400" />
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Vendors</h2>
          </div>
          <div className="px-4 pb-4 flex flex-col gap-3">
            <p className="text-xs text-slate-500">
              Registered vendors are linked to POs and barcode records for traceability.
            </p>

            {vendorError && (
              <div className="flex items-center gap-2 bg-rose-50 border border-rose-200 dark:bg-rose-950/50 dark:border-rose-900 rounded-xl px-3 py-2">
                <AlertCircle className="w-4 h-4 text-rose-500 dark:text-rose-400 flex-shrink-0" />
                <p className="text-xs text-rose-700 dark:text-rose-300">{vendorError}</p>
              </div>
            )}

            <div className="flex gap-2">
              <input
                type="text"
                value={newVendorName}
                onChange={e => setNewVendorName(e.target.value)}
                placeholder="Vendor name…"
                className="flex-1 min-w-0 px-3 py-2.5 bg-[var(--bg-page)] border border-[var(--border-color)] rounded-xl text-[var(--text-primary)] placeholder:text-[var(--text-muted)] text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
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
              <div className="flex flex-col divide-y divide-[var(--border-color)]">
                {vendors.map(v => (
                  <div key={v.id} className="flex items-center gap-3 py-2.5 group">
                    <Building2 className="w-4 h-4 text-slate-600 flex-shrink-0" />
                    <span className="flex-1 min-w-0 text-sm text-[var(--text-secondary)] truncate">{v.vendorName}</span>
                    <button
                      onClick={() => handleDeleteVendor(v.id)}
                      disabled={deletingVendorId === v.id}
                      className="opacity-0 group-hover:opacity-100 transition-opacity w-7 h-7 flex items-center justify-center rounded-lg text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 flex-shrink-0"
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
        <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-2xl overflow-hidden">
          <div className="px-4 pt-4 pb-2 flex items-center gap-2">
            <Type className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Title Abbreviations</h2>
          </div>
          <div className="px-4 pb-4 flex flex-col gap-3">
            <p className="text-xs text-slate-500">
              Automatically shorten phrases in product and variant titles on printed labels and QR codes.
              Matching is case-insensitive.
            </p>

            {mappingsError && (
              <div className="flex items-center gap-2 bg-rose-50 border border-rose-200 dark:bg-rose-950/50 dark:border-rose-900 rounded-xl px-3 py-2">
                <AlertCircle className="w-4 h-4 text-rose-500 dark:text-rose-400 flex-shrink-0" />
                <p className="text-xs text-rose-700 dark:text-rose-300">{mappingsError}</p>
              </div>
            )}

            <div className="flex gap-2">
              <input
                type="text"
                value={newPhrase}
                onChange={e => setNewPhrase(e.target.value)}
                placeholder="Phrase (e.g. ready to cook, cut and clean)"
                className="flex-1 min-w-0 px-3 py-2.5 bg-[var(--bg-page)] border border-[var(--border-color)] rounded-xl text-[var(--text-primary)] placeholder:text-[var(--text-muted)] text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                onKeyDown={e => { if (e.key === 'Enter') handleAddMapping(); }}
              />
              <input
                type="text"
                value={newAbbr}
                onChange={e => setNewAbbr(e.target.value)}
                placeholder="Short (e.g. RC)"
                className="w-24 px-3 py-2.5 bg-[var(--bg-page)] border border-[var(--border-color)] rounded-xl text-[var(--text-primary)] placeholder:text-[var(--text-muted)] text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                onKeyDown={e => { if (e.key === 'Enter') handleAddMapping(); }}
              />
              <button
                onClick={handleAddMapping}
                disabled={mappingsSaving || !newPhrase.trim() || !newAbbr.trim()}
                className="w-10 h-10 flex items-center justify-center rounded-xl bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 transition-colors flex-shrink-0 text-white"
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
              <div className="flex flex-col divide-y divide-[var(--border-color)]">
                {mappings.map(m => (
                  <div key={m.phrase} className="flex items-center gap-3 py-2.5 group">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm text-[var(--text-secondary)] break-all">{m.phrase}</span>
                        <span className="text-slate-600">→</span>
                        <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">{m.abbreviation}</span>
                      </div>
                    </div>
                    <button
                      onClick={() => handleDeleteMapping(m.phrase)}
                      disabled={deletingPhrase === m.phrase}
                      className="opacity-0 group-hover:opacity-100 transition-opacity w-7 h-7 flex items-center justify-center rounded-lg text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 flex-shrink-0"
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
        <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-2xl overflow-hidden">
          <div className="px-4 pt-4 pb-2 flex items-center gap-2">
            <Printer className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Printer Device</h2>
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
                  ? 'bg-amber-50 border-amber-300 text-amber-800 dark:bg-amber-950/40 dark:border-amber-800 dark:text-amber-300'
                  : 'bg-[var(--bg-input)] border-[var(--border-color)] text-slate-400 hover:text-[var(--text-primary)]'
              }`}
            >
              <span className={`w-11 h-6 rounded-full relative transition-colors shrink-0 ${isPrinterDevice ? 'bg-amber-500' : 'bg-[var(--bg-elevated)]'}`}>
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${isPrinterDevice ? 'translate-x-5' : 'translate-x-0'}`} />
              </span>
              {isPrinterDevice ? 'This device is registered as the printer' : 'Register as printer device'}
            </button>
            {isPrinterDevice && (
              <p className="text-xs text-amber-700/70 dark:text-amber-400/70">
                Keep the Scale &amp; Print page open on this device to receive and execute remote print jobs.
              </p>
            )}
          </div>
        </div>

        {/* ── Shopify webhook registration ─────────────────────────────────── */}
        <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-2xl overflow-hidden">
          <div className="px-4 pt-4 pb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Webhook className="w-4 h-4 text-purple-400" />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Shopify Webhooks</h2>
            </div>
            <button
              onClick={fetchRegisteredWebhooks}
              disabled={webhooksLoading}
              className="p-1 rounded-lg text-slate-500 hover:text-[var(--text-secondary)] hover:bg-[var(--bg-input)] transition-colors"
              title="Load registered webhooks"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${webhooksLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
          <div className="px-4 pb-4 flex flex-col gap-3">
            <p className="text-xs text-slate-500">
              Auto-register webhook subscriptions in Shopify. Topics: products/create, products/update,
              products/delete, orders/*. Purchase orders sync via manual full-sync (no Shopify webhook support).
            </p>

            {/* Registered webhooks list */}
            {registeredWebhooks.length > 0 && (
              <div className="flex flex-col gap-1">
                <p className="text-xs text-slate-500 font-medium">{registeredWebhooks.length} registered webhook{registeredWebhooks.length !== 1 ? 's' : ''}:</p>
                {registeredWebhooks.map(w => (
                  <div key={w.id} className="flex items-center gap-2 px-3 py-1.5 bg-[var(--bg-input)] rounded-lg group">
                    <Tag className="w-3 h-3 text-purple-400 flex-shrink-0" />
                    <span className="text-xs font-mono text-[var(--text-secondary)] flex-1 min-w-0 truncate">{w.topic}</span>
                    <button
                      onClick={() => handleDeleteWebhook(w.id)}
                      disabled={deletingWebhookId === w.id}
                      className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 w-6 h-6 flex items-center justify-center rounded text-slate-500 hover:text-rose-400 hover:bg-rose-950/30"
                      title={`Delete ${w.topic}`}
                    >
                      {deletingWebhookId === w.id
                        ? <RefreshCw className="w-3 h-3 animate-spin" />
                        : <Trash2 className="w-3 h-3" />}
                    </button>
                  </div>
                ))}
              </div>
            )}

            {webhookError && (
              <div className="flex items-center gap-2 bg-rose-50 border border-rose-200 dark:bg-rose-950/50 dark:border-rose-900 rounded-xl px-3 py-2">
                <AlertCircle className="w-4 h-4 text-rose-500 dark:text-rose-400 flex-shrink-0" />
                <p className="text-xs text-rose-700 dark:text-rose-300">{webhookError}</p>
              </div>
            )}

            {webhookResult && (
              <div className={`border rounded-xl px-3 py-2.5 flex flex-col gap-1 ${
                webhookResult.errors === 0 ? 'bg-emerald-50 border-emerald-200 dark:bg-emerald-950/40 dark:border-emerald-900' : 'bg-amber-50 border-amber-200 dark:bg-amber-950/40 dark:border-amber-900'
              }`}>
                <p className="text-xs font-semibold text-[var(--text-primary)]">
                  {webhookResult.registered} registered · {webhookResult.alreadyRegistered} already registered
                  {webhookResult.errors > 0 && ` · ${webhookResult.errors} errors`}
                </p>
                {webhookResult.results.filter(r => r.status === 'error').map(r => (
                  <p key={r.topic} className="text-xs text-rose-600 dark:text-rose-400 font-mono">{r.topic}: {r.error}</p>
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
                className="w-full px-3 py-2.5 bg-[var(--bg-page)] border border-[var(--border-color)] rounded-xl text-[var(--text-primary)] placeholder:text-[var(--text-muted)] text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>

            <button
              onClick={handleRegisterWebhooks}
              disabled={webhookRegistering}
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
              your Shopify app&apos;s API secret key (admin → Apps → develop apps → your app → API credentials).
            </p>
          </div>
        </div>

        {/* ── Weight Ranges ─────────────────────────────────────────────── */}
        <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Scale className="w-4 h-4 text-violet-600 dark:text-violet-400" />
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Weight Ranges (Categorical Products)</h2>
          </div>
          <p className="text-xs text-slate-400 mb-3">
            Configure size tiers for products like red chicken. Each tier maps a weight range to a specific variant.
          </p>

          {/* Already-configured products */}
          {wrConfiguredLoading ? (
            <p className="text-xs text-slate-500 mb-3">Loading configured products…</p>
          ) : wrConfiguredProducts.length > 0 ? (
            <div className="mb-4">
              <p className="text-xs text-slate-500 mb-1.5 font-medium uppercase tracking-wide">Configured products</p>
              <div className="flex flex-col gap-1">
                {wrConfiguredProducts.map(p => (
                  <button
                    key={p.productId}
                    onClick={() => handleWrSelectProduct(p.productId, p.productTitle)}
                    className={`w-full flex items-center justify-between text-left px-3 py-2 rounded-xl border text-sm transition-colors ${
                      wrProductId === p.productId
                        ? 'bg-violet-50 border-violet-300 text-violet-800 dark:bg-violet-900/50 dark:border-violet-600 dark:text-violet-200'
                        : 'bg-[var(--bg-input)] border-[var(--border-color)]/60 text-[var(--text-primary)] hover:bg-[var(--bg-input)] hover:border-slate-600'
                    }`}
                  >
                    <span className="truncate">{p.productTitle}</span>
                    <span className="text-xs text-slate-500 ml-2 flex-shrink-0">{p.rulesCount} tier{p.rulesCount !== 1 ? 's' : ''}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {/* Product search */}
          <div className="flex gap-2 mb-3">
            <input
              value={wrProductSearch}
              onChange={e => setWrProductSearch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleWrSearch()}
              placeholder="Search product name…"
              className="flex-1 bg-[var(--bg-input)] border border-[var(--border-color)] rounded-xl px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-violet-500"
            />
            <button
              onClick={handleWrSearch}
              disabled={wrSearching || !wrProductSearch.trim()}
              className="px-4 py-2 bg-violet-700 hover:bg-violet-600 disabled:opacity-50 rounded-xl text-sm font-medium text-white transition-colors"
            >
              {wrSearching ? <RefreshCw className="w-4 h-4 animate-spin" /> : 'Search'}
            </button>
          </div>

          {wrProductResults.length > 0 && (
            <div className="bg-[var(--bg-input)] border border-[var(--border-color)] rounded-xl mb-3 overflow-hidden">
              {wrProductResults.map(p => (
                <button
                  key={p.productId}
                  onClick={() => handleWrSelectProduct(p.productId, p.productTitle)}
                  className="w-full text-left px-3 py-2.5 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors border-b border-[var(--border-color)] last:border-0"
                >
                  {p.productTitle}
                </button>
              ))}
            </div>
          )}

          {wrProductId && (
            <div>
              <p className="text-xs text-violet-700 dark:text-violet-300 font-medium mb-3">{wrProductTitle}</p>
              {wrLoading ? (
                <p className="text-xs text-slate-400">Loading…</p>
              ) : (
                <>
                  <div className="space-y-2 mb-3">
                    {wrRules.map((rule, idx) => {
                      const tier = wrTierMeta[idx] ?? emptyTierMeta();
                      return (
                        <div key={idx} className="bg-[var(--bg-input)] border border-[var(--border-color)]/60 rounded-xl p-3 flex flex-col gap-2">
                          {/* Label + delete */}
                          <div className="flex gap-2">
                            <input
                              value={rule.label}
                              onChange={e => handleWrUpdateRule(idx, 'label', e.target.value)}
                              placeholder="Label (auto-filled from product)"
                              className="flex-1 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-violet-500"
                            />
                            <button onClick={() => handleWrRemoveRule(idx)} className="text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 transition-colors p-1">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          {/* Weight range */}
                          <div className="flex gap-2">
                            <input
                              type="number"
                              value={rule.minLbs}
                              onChange={e => handleWrUpdateRule(idx, 'minLbs', parseFloat(e.target.value) || 0)}
                              placeholder="Min lbs"
                              className="w-24 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-violet-500"
                            />
                            <input
                              type="number"
                              value={rule.maxLbs ?? ''}
                              onChange={e => handleWrUpdateRule(idx, 'maxLbs', e.target.value ? parseFloat(e.target.value) : null)}
                              placeholder="Max lbs (blank = no limit)"
                              className="flex-1 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-violet-500"
                            />
                          </div>
                          {/* Target product */}
                          {tier.targetProductTitle ? (
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-emerald-600 dark:text-emerald-400 flex-1 truncate">{tier.targetProductTitle}</span>
                              {tier.targetVariants.length > 1 && (
                                <select
                                  value={rule.variantId}
                                  onChange={e => handleWrUpdateRule(idx, 'variantId', e.target.value)}
                                  className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg px-2 py-1 text-xs text-[var(--text-primary)] focus:outline-none focus:border-violet-500"
                                >
                                  <option value="">— variant —</option>
                                  {tier.targetVariants.map(v => (
                                    <option key={v.variantId} value={v.variantId}>{v.variantTitle || 'Default Title'}</option>
                                  ))}
                                </select>
                              )}
                              <button onClick={() => handleWrTierClear(idx)} className="text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 transition-colors p-0.5">
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <div className="relative">
                              <input
                                value={tier.targetSearch}
                                onChange={e => handleWrTierSearch(idx, e.target.value)}
                                placeholder="Search output product…"
                                className="w-full bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-violet-500"
                              />
                              {tier.searching && <RefreshCw className="absolute right-2 top-1.5 w-3 h-3 text-slate-400 animate-spin" />}
                              {tier.targetResults.length > 0 && (
                                <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-[var(--bg-input)] border border-[var(--border-color)] rounded-xl overflow-hidden shadow-lg">
                                  {tier.targetResults.map(p => (
                                    <button
                                      key={p.productId}
                                      onClick={() => handleWrTierSelectProduct(idx, p.productId, p.productTitle)}
                                      className="w-full text-left px-3 py-2 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors border-b border-[var(--border-color)] last:border-0"
                                    >
                                      {p.productTitle}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={handleWrAddRule}
                      className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-[var(--text-primary)] border border-[var(--border-color)] hover:border-slate-500 rounded-xl px-3 py-2 transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" /> Add tier
                    </button>
                    <button
                      onClick={handleWrSave}
                      disabled={wrSaving}
                      className="flex-1 flex items-center justify-center gap-1.5 text-xs bg-violet-700 hover:bg-violet-600 disabled:opacity-50 rounded-xl px-3 py-2 font-medium text-white transition-colors"
                    >
                      {wrSaving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : wrSaved ? <><Check className="w-3.5 h-3.5 text-emerald-300" /> Saved</> : 'Save ranges'}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {wrError && (
            <div className="flex items-center gap-2 mt-2 text-xs text-rose-600 dark:text-rose-400">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" /> {wrError}
            </div>
          )}
        </div>

        {/* ── Lot Products ──────────────────────────────────────────────────── */}
        <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Layers className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Lot Products</h2>
          </div>
          <p className="text-xs text-slate-400 mb-3">
            Products marked as lot method use the PO quantity for Shopify inventory — barcode count is not the unit count. Beef, lamb, goat, and chicken are typical lot products.
          </p>

          {/* Configured lot products */}
          {lotProductsLoading ? (
            <p className="text-xs text-slate-500 mb-3">Loading lot products…</p>
          ) : lotProducts.length > 0 ? (
            <div className="mb-4">
              <p className="text-xs text-slate-500 mb-1.5 font-medium uppercase tracking-wide">Configured lot products</p>
              <div className="flex flex-col gap-1">
                {lotProducts.map(p => (
                  <div
                    key={p.productId}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-xl border bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-800/40 text-sm"
                  >
                    <span className="text-amber-800 dark:text-amber-200 truncate">{p.productTitle}</span>
                    <span className="text-xs text-slate-500 ml-2 flex-shrink-0">
                      {p.configuredAt ? new Date(p.configuredAt).toLocaleDateString() : ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-600 mb-3">No lot products configured yet.</p>
          )}

          {/* Search and add */}
          <div className="flex gap-2 mb-3">
            <input
              value={lotProductSearch}
              onChange={e => setLotProductSearch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLotProductSearch()}
              placeholder="Search product to add as lot…"
              className="flex-1 bg-[var(--bg-input)] border border-[var(--border-color)] rounded-xl px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-amber-500"
            />
            <button
              onClick={handleLotProductSearch}
              disabled={lotProductSearching || !lotProductSearch.trim()}
              className="px-4 py-2 bg-amber-700 hover:bg-amber-600 disabled:opacity-50 rounded-xl text-sm font-medium transition-colors"
            >
              {lotProductSearching ? <RefreshCw className="w-4 h-4 animate-spin" /> : 'Search'}
            </button>
          </div>

          {lotProductResults.length > 0 && (
            <div className="bg-[var(--bg-input)] border border-[var(--border-color)] rounded-xl mb-3 overflow-hidden">
              {lotProductResults.map(p => (
                <button
                  key={p.productId}
                  onClick={() => handleAddLotProduct(p.productId, p.productTitle)}
                  disabled={lotProductSaving || lotProducts.some(lp => lp.productId === p.productId)}
                  className="w-full text-left px-3 py-2.5 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] disabled:opacity-50 transition-colors border-b border-[var(--border-color)] last:border-0 flex items-center justify-between"
                >
                  <span>{p.productTitle}</span>
                  {lotProducts.some(lp => lp.productId === p.productId) ? (
                    <span className="text-xs text-amber-600 dark:text-amber-400 flex-shrink-0 ml-2">Already configured</span>
                  ) : (
                    <span className="text-xs text-slate-500 flex-shrink-0 ml-2">+ Mark as lot</span>
                  )}
                </button>
              ))}
            </div>
          )}

          {lotProductError && (
            <div className="flex items-center gap-2 mt-2 text-xs text-rose-600 dark:text-rose-400">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" /> {lotProductError}
            </div>
          )}
        </div>

        {/* ── Theme ─────────────────────────────────────────────────────────── */}
        <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4">
            {theme === 'dark' ? (
              <Moon className="w-4 h-4 text-indigo-400" />
            ) : (
              <Sun className="w-4 h-4 text-amber-500" />
            )}
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Theme</h2>
          </div>
          <p className="text-xs text-[var(--text-muted)] mb-4">
            Light mode is easier to read under bright warehouse lighting. Your preference is saved per device.
          </p>
          <button
            onClick={toggleTheme}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-sm font-medium transition-colors w-full ${
              theme === 'dark'
                ? 'bg-indigo-950/40 border-indigo-800 text-indigo-300'
                : 'bg-amber-50 border-amber-200 text-amber-800'
            }`}
          >
            <span className={`w-11 h-6 rounded-full relative transition-colors shrink-0 ${theme === 'dark' ? 'bg-indigo-500' : 'bg-amber-400'}`}>
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${theme === 'dark' ? 'translate-x-5' : 'translate-x-0'}`} />
            </span>
            {theme === 'dark' ? (
              <span className="flex items-center gap-2"><Moon className="w-4 h-4" /> Dark mode</span>
            ) : (
              <span className="flex items-center gap-2"><Sun className="w-4 h-4" /> Light mode</span>
            )}
          </button>
        </div>

        {/* ── Failed Operations ─────────────────────────────────────────────── */}
        <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-2xl p-5">
          <button
            className="w-full flex items-center justify-between gap-2"
            onClick={() => {
              if (!failedOpsOpen) fetchDeadJobs();
              setFailedOpsOpen(o => !o);
            }}
          >
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-rose-400" />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Failed Operations</h2>
              {deadJobs.length > 0 && (
                <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-rose-600 text-white text-[10px] font-bold">
                  {deadJobs.length}
                </span>
              )}
            </div>
            {failedOpsOpen ? (
              <ChevronUp className="w-4 h-4 text-slate-500" />
            ) : (
              <ChevronDown className="w-4 h-4 text-slate-500" />
            )}
          </button>

          {failedOpsOpen && (
            <div className="mt-4">
              <p className="text-xs text-slate-400 mb-3">
                Operations that failed after 3 retries. Each can be retried or dismissed (kept in log but hidden).
              </p>

              <div className="flex justify-end mb-2">
                <button
                  onClick={fetchDeadJobs}
                  disabled={deadLoading}
                  className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-[var(--text-primary)] transition-colors"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${deadLoading ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
              </div>

              {deadError && (
                <div className="flex items-center gap-2 text-xs text-rose-600 dark:text-rose-400 mb-3">
                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" /> {deadError}
                </div>
              )}

              {!deadLoading && deadJobs.length === 0 && !deadError && (
                <p className="text-xs text-slate-600 text-center py-4">No failed operations — all clear.</p>
              )}

              {deadJobs.length > 0 && (
                <div className="flex flex-col gap-2">
                  {deadJobs.map(job => (
                    <div
                      key={job.id}
                      className="bg-rose-50 border border-rose-200 dark:bg-rose-950/30 dark:border-rose-900/40 rounded-xl p-3 flex flex-col gap-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-rose-700 dark:text-rose-300">{jobTypeLabel(job.jobType)}</p>
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            {job.failedAt ? new Date(job.failedAt).toLocaleString() : new Date(job.createdAt).toLocaleString()}
                            {job.deviceId && ` · ${job.deviceId}`}
                            {` · ${job.retryCount} retries`}
                          </p>
                          {job.failedReason && (
                            <p className="text-[11px] text-rose-600/80 dark:text-rose-400/80 mt-1 break-all">{job.failedReason}</p>
                          )}
                        </div>
                      </div>

                      <div className="flex gap-2">
                        <button
                          onClick={async () => {
                            setFailedOpsActing(job.id);
                            await retryJob(job.id);
                            setFailedOpsActing(null);
                          }}
                          disabled={failedOpsActing === job.id}
                          className="flex-1 flex items-center justify-center gap-1.5 h-8 bg-rose-100 hover:bg-rose-200 dark:bg-rose-800/60 dark:hover:bg-rose-700/60 disabled:opacity-50 rounded-lg text-xs text-rose-800 dark:text-rose-200 font-medium transition-colors"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          Retry
                        </button>
                        <button
                          onClick={async () => {
                            setFailedOpsActing(job.id);
                            await dismissJob(job.id);
                            setFailedOpsActing(null);
                          }}
                          disabled={failedOpsActing === job.id}
                          className="flex-1 flex items-center justify-center gap-1.5 h-8 bg-[var(--bg-input)] hover:bg-[var(--bg-elevated)] disabled:opacity-50 rounded-lg text-xs text-slate-400 font-medium transition-colors"
                        >
                          <X className="w-3.5 h-3.5" />
                          Dismiss
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

      </div>
    </main>
  );
}
