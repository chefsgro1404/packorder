"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { StatusBanner } from "@/components/StatusBanner";
import { useScanner } from "@/hooks/useScanner";
import { CachedVariant } from "@/lib/types";
import {
  ArrowLeft, Search, Tag, CheckCircle2, X, ScanLine,
  RefreshCw, Filter, ChevronDown,
} from "lucide-react";
import Image from "next/image";

type AssignStep = "list" | "scan" | "confirm" | "saving" | "done";

interface BannerState {
  type: "success" | "error" | "warning" | "info";
  message: string;
}

export default function AssignPage() {
  const router = useRouter();
  const { handleScan, playBeep } = useScanner();

  // ── Product list state ──────────────────────────────────────────────────
  const [variants, setVariants] = useState<CachedVariant[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [lastSync, setLastSync] = useState<string | null>(null);

  // ── Filter state ────────────────────────────────────────────────────────
  const [filterText, setFilterText] = useState("");
  const [filterBarcode, setFilterBarcode] = useState<"all" | "yes" | "no">("all");
  const [filterVendor, setFilterVendor] = useState("all");

  // ── Sync modal state ────────────────────────────────────────────────────
  const [syncOpen, setSyncOpen] = useState(false);
  const [syncMode, setSyncMode] = useState<"incremental" | "full">("incremental");
  const [syncVendors, setSyncVendors] = useState("");
  const [syncTags, setSyncTags] = useState("");
  const [syncClear, setSyncClear] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // ── Assignment flow state ───────────────────────────────────────────────
  const [step, setStep] = useState<AssignStep>("list");
  const [selectedVariant, setSelectedVariant] = useState<CachedVariant | null>(null);
  const [scannedBarcode, setScannedBarcode] = useState<string | null>(null);
  const [banner, setBanner] = useState<BannerState | null>(null);

  // ── Load products on mount ──────────────────────────────────────────────
  useEffect(() => {
    loadProducts();
  }, []);

  const loadProducts = async () => {
    setLoadingList(true);
    try {
      const res = await fetch("/api/products");
      const data = await res.json();
      setVariants(data.variants ?? []);
      setLastSync(data.lastSync ?? null);
    } catch {
      setBanner({ type: "error", message: "Failed to load product list" });
    } finally {
      setLoadingList(false);
    }
  };

  // ── Derived: filtered list ──────────────────────────────────────────────
  const vendors = useMemo(
    () => Array.from(new Set(variants.map((v) => v.vendor))).filter(Boolean).sort(),
    [variants]
  );

  const filteredVariants = useMemo(() => {
    return variants.filter((v) => {
      if (filterBarcode === "yes" && !v.barcode) return false;
      if (filterBarcode === "no" && v.barcode) return false;
      if (filterVendor !== "all" && v.vendor !== filterVendor) return false;
      if (filterText.trim().length > 0) {
        const q = filterText.toLowerCase();
        return (
          v.productTitle.toLowerCase().includes(q) ||
          v.variantTitle.toLowerCase().includes(q) ||
          (v.sku?.toLowerCase().includes(q) ?? false) ||
          (v.barcode?.toLowerCase().includes(q) ?? false)
        );
      }
      return true;
    });
  }, [variants, filterBarcode, filterVendor, filterText]);

  const missingBarcodeCount = useMemo(
    () => variants.filter((v) => !v.barcode).length,
    [variants]
  );

  // ── Sync ────────────────────────────────────────────────────────────────
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
        setSyncOpen(false);
        await loadProducts();
        setBanner({ type: "success", message: `Synced ${data.synced} variants` });
      } else {
        setBanner({ type: "error", message: data.error || "Sync failed" });
      }
    } catch {
      setBanner({ type: "error", message: "Sync failed — check your connection" });
    } finally {
      setSyncing(false);
    }
  };

  // ── Assignment flow ─────────────────────────────────────────────────────
  const handleSelectVariant = (variant: CachedVariant) => {
    setSelectedVariant(variant);
    setStep("scan");
    setScannedBarcode(null);
    setBanner(null);
  };

  const onBarcodeScan = useCallback(
    (value: string) => {
      handleScan(value, (decoded) => {
        playBeep();
        setScannedBarcode(decoded);
        setStep("confirm");
      });
    },
    [handleScan, playBeep]
  );

  const handleConfirm = async () => {
    if (!selectedVariant || !scannedBarcode) return;
    setStep("saving");

    try {
      const res = await fetch("/api/variant", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: selectedVariant.productId,
          variantId: selectedVariant.variantId,
          barcode: scannedBarcode,
        }),
      });
      const data = await res.json();

      if (data.ok) {
        navigator.vibrate?.(100);
        // Update local list immediately
        setVariants((prev) =>
          prev.map((v) =>
            v.variantId === selectedVariant.variantId ? { ...v, barcode: scannedBarcode } : v
          )
        );
        setStep("done");
      } else {
        setBanner({ type: "error", message: data.error || "Failed to save barcode" });
        setStep("confirm");
      }
    } catch {
      setBanner({ type: "error", message: "Network error. Try again." });
      setStep("confirm");
    }
  };

  const handleReset = () => {
    setStep("list");
    setSelectedVariant(null);
    setScannedBarcode(null);
    setBanner(null);
  };

  const formattedLastSync = lastSync
    ? new Date(lastSync).toLocaleString(undefined, {
        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
      })
    : null;

  return (
    <main className="min-h-screen flex flex-col bg-slate-950">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-slate-900 border-b border-slate-800 sticky top-0 z-10">
        <button
          onClick={() => (step === "list" ? router.push("/") : handleReset())}
          className="p-2 -ml-2 text-slate-400 hover:text-slate-200 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="font-bold text-slate-100">Assign Barcode</h1>
        {step === "list" ? (
          <button
            onClick={() => setSyncOpen(true)}
            className="p-2 -mr-2 text-slate-400 hover:text-slate-200 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
            title="Sync products"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
        ) : (
          <div className="w-9" />
        )}
      </div>

      {/* Step indicator (scan/confirm steps only) */}
      {step !== "list" && step !== "done" && (
        <div className="flex items-center gap-2 px-4 py-2 bg-slate-900/50 border-b border-slate-800/50">
          {(["scan", "confirm"] as const).map((s, i) => {
            const active = step === s || (step === "saving" && s === "confirm");
            const done = s === "scan" && (step === "confirm" || step === "saving");
            return (
              <div key={s} className="flex items-center gap-2">
                {i > 0 && <div className="w-6 h-px bg-slate-700" />}
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                  active ? "bg-purple-600 text-white" : done ? "bg-purple-900/50 text-purple-400" : "bg-slate-800 text-slate-500"
                }`}>
                  {i + 1}
                </div>
                <span className={`text-xs ${active ? "text-slate-200 font-medium" : "text-slate-500"}`}>
                  {s === "scan" ? "Scan" : "Confirm"}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex-1 flex flex-col gap-4 p-4 overflow-y-auto pb-safe">
        {banner && (
          <StatusBanner
            type={banner.type}
            message={banner.message}
            autoDismiss={4000}
            onDismiss={() => setBanner(null)}
          />
        )}

        {/* ── List view ──────────────────────────────────────────────── */}
        {step === "list" && (
          <>
            {/* Filter bar */}
            <div className="space-y-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type="text"
                  value={filterText}
                  onChange={(e) => setFilterText(e.target.value)}
                  placeholder="Search by name, SKU or barcode…"
                  className="w-full pl-10 pr-10 py-3 bg-slate-900 border border-slate-700 rounded-xl text-slate-100 placeholder-slate-500 text-base focus:outline-none focus:ring-2 focus:ring-purple-500 min-h-[48px]"
                />
                {filterText && (
                  <button
                    onClick={() => setFilterText("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              <div className="flex gap-2">
                {/* Barcode filter */}
                <div className="flex rounded-lg overflow-hidden border border-slate-700 text-xs font-medium">
                  {(["all", "yes", "no"] as const).map((v) => (
                    <button
                      key={v}
                      onClick={() => setFilterBarcode(v)}
                      className={`px-3 py-2 transition-colors min-h-[36px] ${
                        filterBarcode === v
                          ? "bg-purple-700 text-white"
                          : "bg-slate-900 text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      {v === "all" ? "All" : v === "yes" ? "Has barcode" : "No barcode"}
                    </button>
                  ))}
                </div>

                {/* Vendor filter */}
                {vendors.length > 0 && (
                  <div className="relative flex-1 min-w-0">
                    <Filter className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
                    <select
                      value={filterVendor}
                      onChange={(e) => setFilterVendor(e.target.value)}
                      className="w-full pl-8 pr-7 py-2 bg-slate-900 border border-slate-700 rounded-lg text-slate-300 text-xs appearance-none focus:outline-none focus:ring-2 focus:ring-purple-500 min-h-[36px]"
                    >
                      <option value="all">All vendors</option>
                      {vendors.map((v) => (
                        <option key={v} value={v}>{v}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
                  </div>
                )}
              </div>
            </div>

            {/* Stats row */}
            {!loadingList && variants.length > 0 && (
              <div className="flex items-center justify-between text-xs text-slate-500 px-1">
                <span>
                  {filteredVariants.length} of {variants.length} variants
                  {missingBarcodeCount > 0 && (
                    <span className="text-orange-400 ml-2">· {missingBarcodeCount} without barcode</span>
                  )}
                </span>
                {formattedLastSync && <span>Synced {formattedLastSync}</span>}
              </div>
            )}

            {/* Loading state */}
            {loadingList && (
              <div className="flex items-center justify-center py-12">
                <div className="flex gap-2">
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      className="w-2 h-2 rounded-full bg-purple-400 animate-bounce"
                      style={{ animationDelay: `${i * 150}ms` }}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Empty: not synced yet */}
            {!loadingList && variants.length === 0 && (
              <div className="flex flex-col items-center justify-center py-14 text-slate-500 gap-3">
                <RefreshCw className="w-10 h-10 opacity-30" />
                <p className="text-sm font-medium">No products synced yet</p>
                <p className="text-xs text-slate-600 text-center">
                  Tap the sync button in the top right to load your product catalogue.
                </p>
                <button
                  onClick={() => setSyncOpen(true)}
                  className="mt-2 px-4 py-2 bg-purple-700 hover:bg-purple-600 rounded-lg text-sm font-medium text-white transition-colors"
                >
                  Sync now
                </button>
              </div>
            )}

            {/* Empty: filter has no results */}
            {!loadingList && variants.length > 0 && filteredVariants.length === 0 && (
              <div className="flex flex-col items-center justify-center py-10 text-slate-500 gap-2">
                <Search className="w-10 h-10 opacity-30" />
                <p className="text-sm">No variants match your filters</p>
              </div>
            )}

            {/* Variant list */}
            {!loadingList && filteredVariants.length > 0 && (
              <div className="space-y-2">
                {filteredVariants.map((variant) => (
                  <button
                    key={variant.variantId}
                    onClick={() => handleSelectVariant(variant)}
                    className="w-full flex items-center gap-3 p-3 bg-slate-900 border border-slate-700 hover:border-purple-500/50 hover:bg-slate-800 rounded-xl transition-all duration-150 active:scale-[0.98] text-left"
                  >
                    {variant.imageUrl ? (
                      <div className="relative w-12 h-12 rounded-lg overflow-hidden bg-slate-800 shrink-0">
                        <Image
                          src={variant.imageUrl}
                          alt={variant.productTitle}
                          fill
                          className="object-cover"
                          sizes="48px"
                        />
                      </div>
                    ) : (
                      <div className="w-12 h-12 rounded-lg bg-slate-800 flex items-center justify-center shrink-0">
                        <span className="text-xl">📦</span>
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-slate-100 text-sm leading-tight truncate">
                        {variant.variantTitle !== "Default Title"
                          ? variant.variantTitle
                          : variant.productTitle}
                      </p>
                      {variant.variantTitle !== "Default Title" && (
                        <p className="text-xs text-slate-500 mt-0.5 truncate">{variant.productTitle}</p>
                      )}
                      <div className="flex items-center gap-2 mt-1">
                        {variant.sku && (
                          <span className="text-xs font-mono text-slate-500">{variant.sku}</span>
                        )}
                        {variant.barcode ? (
                          <span className="text-xs px-1.5 py-0.5 bg-green-900/40 text-green-400 rounded border border-green-800/50">
                            has barcode
                          </span>
                        ) : (
                          <span className="text-xs px-1.5 py-0.5 bg-orange-900/40 text-orange-400 rounded border border-orange-800/50">
                            no barcode
                          </span>
                        )}
                      </div>
                    </div>
                    <Tag className="w-4 h-4 text-slate-600 shrink-0" />
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {/* ── Step: Scan barcode ─────────────────────────────────────── */}
        {step === "scan" && selectedVariant && (
          <>
            <div className="flex items-center gap-3 p-3 bg-purple-950/40 border border-purple-800/50 rounded-xl">
              {selectedVariant.imageUrl ? (
                <div className="relative w-10 h-10 rounded-lg overflow-hidden bg-slate-800 shrink-0">
                  <Image src={selectedVariant.imageUrl} alt={selectedVariant.productTitle} fill className="object-cover" sizes="40px" />
                </div>
              ) : (
                <div className="w-10 h-10 rounded-lg bg-slate-800 flex items-center justify-center shrink-0">
                  <span className="text-lg">📦</span>
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-200 truncate">
                  {selectedVariant.variantTitle !== "Default Title"
                    ? selectedVariant.variantTitle
                    : selectedVariant.productTitle}
                </p>
                {selectedVariant.variantTitle !== "Default Title" && (
                  <p className="text-xs text-slate-500">{selectedVariant.productTitle}</p>
                )}
                {selectedVariant.barcode && (
                  <p className="text-xs text-orange-400 mt-0.5">
                    Will replace: <span className="font-mono">{selectedVariant.barcode}</span>
                  </p>
                )}
              </div>
              <button onClick={handleReset} className="p-1.5 text-slate-500 hover:text-slate-300 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-1">
              <p className="text-sm font-medium text-slate-300 flex items-center gap-2">
                <ScanLine className="w-4 h-4 text-purple-400" />
                Scan the barcode label
              </p>
              <p className="text-xs text-slate-500">Point the camera at the product barcode or sticker.</p>
            </div>

            <BarcodeScanner onScan={onBarcodeScan} active={step === "scan"} />
          </>
        )}

        {/* ── Step: Confirm ──────────────────────────────────────────── */}
        {(step === "confirm" || step === "saving") && selectedVariant && scannedBarcode && (
          <div className="space-y-4">
            <div className="bg-slate-900 border border-slate-700 rounded-2xl p-4 space-y-4">
              <h2 className="font-bold text-slate-100 text-base">Confirm Assignment</h2>
              <div className="flex items-center gap-3">
                {selectedVariant.imageUrl ? (
                  <div className="relative w-14 h-14 rounded-xl overflow-hidden bg-slate-800 shrink-0">
                    <Image src={selectedVariant.imageUrl} alt={selectedVariant.productTitle} fill className="object-cover" sizes="56px" />
                  </div>
                ) : (
                  <div className="w-14 h-14 rounded-xl bg-slate-800 flex items-center justify-center shrink-0">
                    <span className="text-2xl">📦</span>
                  </div>
                )}
                <div>
                  <p className="font-semibold text-slate-100">
                    {selectedVariant.variantTitle !== "Default Title"
                      ? selectedVariant.variantTitle
                      : selectedVariant.productTitle}
                  </p>
                  {selectedVariant.variantTitle !== "Default Title" && (
                    <p className="text-sm text-slate-500">{selectedVariant.productTitle}</p>
                  )}
                  {selectedVariant.sku && (
                    <p className="text-xs font-mono text-slate-500 mt-0.5">SKU: {selectedVariant.sku}</p>
                  )}
                </div>
              </div>

              <div className="border-t border-slate-800 pt-3 space-y-2">
                {selectedVariant.barcode && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-400">Current barcode</span>
                    <span className="font-mono text-slate-500 line-through">{selectedVariant.barcode}</span>
                  </div>
                )}
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-300 font-medium">New barcode</span>
                  <span className="font-mono text-purple-300 text-base font-bold">{scannedBarcode}</span>
                </div>
              </div>
            </div>

            <button
              onClick={handleConfirm}
              disabled={step === "saving"}
              className="w-full py-4 bg-purple-700 hover:bg-purple-600 active:scale-[0.98] disabled:opacity-50 rounded-xl font-bold text-base transition-all min-h-[56px] flex items-center justify-center gap-2"
            >
              <Tag className="w-5 h-5" />
              {step === "saving" ? "Saving…" : "Save to Shopify"}
            </button>

            <button
              onClick={() => { setStep("scan"); setScannedBarcode(null); }}
              disabled={step === "saving"}
              className="w-full py-3 text-slate-400 hover:text-slate-200 text-sm transition-colors min-h-[48px]"
            >
              Re-scan barcode
            </button>
          </div>
        )}

        {/* ── Done ───────────────────────────────────────────────────── */}
        {step === "done" && selectedVariant && scannedBarcode && (
          <div className="flex flex-col items-center justify-center flex-1 gap-5 animate-in fade-in duration-300 py-8">
            <div className="w-24 h-24 rounded-full bg-purple-900/50 border-2 border-purple-500 flex items-center justify-center">
              <CheckCircle2 className="w-12 h-12 text-purple-400" />
            </div>
            <div className="text-center space-y-1">
              <h2 className="text-2xl font-bold text-purple-300">Barcode Saved!</h2>
              <p className="text-slate-400 text-sm">{selectedVariant.productTitle}</p>
              <p className="font-mono text-slate-300 text-base mt-2">{scannedBarcode}</p>
            </div>
            <div className="flex flex-col gap-3 w-full max-w-xs mt-4">
              <button
                onClick={() => { setStep("scan"); setScannedBarcode(null); setBanner(null); }}
                className="w-full py-3 bg-slate-800 hover:bg-slate-700 rounded-xl font-medium text-sm transition-colors min-h-[48px]"
              >
                Assign another barcode to same product
              </button>
              <button
                onClick={handleReset}
                className="w-full py-3 bg-purple-700 hover:bg-purple-600 rounded-xl font-bold text-sm transition-colors min-h-[48px]"
              >
                Back to product list
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Sync modal ─────────────────────────────────────────────────── */}
      {syncOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setSyncOpen(false); }}
        >
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-sm p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-slate-100 text-base">Sync Products</h2>
              <button onClick={() => setSyncOpen(false)} className="text-slate-500 hover:text-slate-300">
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
                  {syncVendors.trim()
                    ? "Deletes all entries for the specified vendors, then re-syncs them fresh."
                    : "Deletes all cached variants, then re-syncs. Use to remove stale data."}
                </p>
              </div>
            </label>

            {formattedLastSync && (
              <p className="text-xs text-slate-500">Last synced: {formattedLastSync}</p>
            )}

            {/* Actions */}
            <div className="flex gap-3 pt-1">
              <button
                onClick={() => setSyncOpen(false)}
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
      )}
    </main>
  );
}
