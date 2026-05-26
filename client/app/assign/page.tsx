"use client";

import { useState, useCallback, useEffect, useRef, Suspense } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { StatusBanner } from "@/components/StatusBanner";
import { SyncModal } from "@/components/SyncModal";
import { useScanner } from "@/hooks/useScanner";
import { CachedVariant, AssignProduct, AssignVariant } from "@/lib/types";
import {
  ArrowLeft, Search, Tag, CheckCircle2, X, ScanLine,
  RefreshCw, Filter, ChevronDown,
} from "lucide-react";
import Image from "next/image";

type AssignStep = "list" | "scan" | "confirm" | "saving" | "done";
type BarcodeFilter = "all" | "yes" | "no";
type StatusFilter = "all" | "ACTIVE" | "DRAFT" | "ARCHIVED";

interface BannerState {
  type: "success" | "error" | "warning" | "info";
  message: string;
}

const PAGE_SIZE = 50;

function buildApiUrl(
  search: string,
  vendor: string,
  hasBarcode: BarcodeFilter,
  status: StatusFilter,
  page: number
) {
  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (search.trim())        params.set("search",     search.trim());
  if (vendor !== "all")     params.set("vendor",     vendor);
  if (hasBarcode !== "all") params.set("hasBarcode", hasBarcode);
  if (status !== "all")     params.set("status",     status);
  return `/api/products?${params}`;
}

function toCachedVariant(product: AssignProduct, variant: AssignVariant): CachedVariant {
  return {
    productId:    product.productId,
    variantId:    variant.variantId,
    productTitle: product.productTitle,
    variantTitle: variant.variantTitle,
    sku:          variant.sku,
    barcode:      variant.barcode,
    vendor:       product.vendor,
    tags:         product.tags,
    imageUrl:     product.imageUrl,
    price:        variant.price,
    status:       product.status,
  };
}

// ── Inner page (needs useSearchParams, wrapped in Suspense below) ─────────────

function AssignPageInner() {
  const router       = useRouter();
  const pathname     = usePathname();
  const searchParams = useSearchParams();
  const { handleScan, playBeep } = useScanner();

  const urlSearch     = searchParams.get("search")     ?? "";
  const urlVendor     = searchParams.get("vendor")     ?? "all";
  const urlHasBarcode = (searchParams.get("hasBarcode") ?? "all") as BarcodeFilter;
  const urlStatus     = (searchParams.get("status")    ?? "all") as StatusFilter;

  const [searchInput, setSearchInput] = useState(urlSearch);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [products, setProducts]       = useState<AssignProduct[]>([]);
  const [loading, setLoading]         = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage]               = useState(1);
  const [hasMore, setHasMore]         = useState(false);
  const [total, setTotal]             = useState(0);
  const [missingCount, setMissingCount] = useState(0);
  const [lastSync, setLastSync]       = useState<string | null>(null);
  const [vendors, setVendors]         = useState<string[]>([]);
  const [syncOpen, setSyncOpen]       = useState(false);
  const [banner, setBanner]           = useState<BannerState | null>(null);
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set());

  const [step, setStep]                         = useState<AssignStep>("list");
  const [selectedVariant, setSelectedVariant]   = useState<CachedVariant | null>(null);
  const [scannedBarcode, setScannedBarcode]     = useState<string | null>(null);

  // ── URL updater ─────────────────────────────────────────────────────────
  const pushFilters = useCallback(
    (search: string, vendor: string, hasBarcode: BarcodeFilter, status: StatusFilter) => {
      const params = new URLSearchParams();
      if (search.trim())        params.set("search",     search.trim());
      if (vendor !== "all")     params.set("vendor",     vendor);
      if (hasBarcode !== "all") params.set("hasBarcode", hasBarcode);
      if (status !== "all")     params.set("status",     status);
      router.replace(`${pathname}?${params}`, { scroll: false });
    },
    [router, pathname]
  );

  // ── Fetch a page ─────────────────────────────────────────────────────────
  const fetchPage = useCallback(
    async (
      search: string,
      vendor: string,
      hasBarcode: BarcodeFilter,
      status: StatusFilter,
      p: number,
      append: boolean
    ) => {
      if (p === 1) setLoading(true);
      else         setLoadingMore(true);

      try {
        const res  = await fetch(buildApiUrl(search, vendor, hasBarcode, status, p));
        const data = await res.json();
        const incoming: AssignProduct[] = data.products ?? [];
        setProducts(prev => append ? [...prev, ...incoming] : incoming);
        setTotal(data.total ?? 0);
        setMissingCount(data.missingCount ?? 0);
        setHasMore(data.hasMore ?? false);
        setLastSync(data.lastSync ?? null);
        if (data.vendors?.length) setVendors(data.vendors);
      } catch {
        setBanner({ type: "error", message: "Failed to load product list" });
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    []
  );

  // ── Re-fetch when URL search params change ────────────────────────────────
  useEffect(() => {
    setPage(1);
    setProducts([]);
    setExpandedProducts(new Set());
    fetchPage(urlSearch, urlVendor, urlHasBarcode, urlStatus, 1, false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // ── Filter handlers ──────────────────────────────────────────────────────
  const handleSearchChange = (value: string) => {
    setSearchInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      pushFilters(value, urlVendor, urlHasBarcode, urlStatus);
    }, 300);
  };

  const handleVendorChange     = (v: string)        => pushFilters(urlSearch, v,         urlHasBarcode, urlStatus);
  const handleHasBarcodeChange = (v: BarcodeFilter) => pushFilters(urlSearch, urlVendor, v,             urlStatus);
  const handleStatusChange     = (v: StatusFilter)  => pushFilters(urlSearch, urlVendor, urlHasBarcode, v);

  const handleLoadMore = () => {
    const next = page + 1;
    setPage(next);
    fetchPage(urlSearch, urlVendor, urlHasBarcode, urlStatus, next, true);
  };

  // ── Product expand/collapse ───────────────────────────────────────────────
  const toggleExpand = (productId: string) => {
    setExpandedProducts(prev => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  };

  // ── Sync ─────────────────────────────────────────────────────────────────
  const handleSynced = async (count: number) => {
    setSyncOpen(false);
    setPage(1);
    setProducts([]);
    setExpandedProducts(new Set());
    await fetchPage(urlSearch, urlVendor, urlHasBarcode, urlStatus, 1, false);
    setBanner({ type: "success", message: `Synced ${count} variants` });
  };
  const handleSyncError = (msg: string) => setBanner({ type: "error", message: msg });

  // ── Assignment flow ───────────────────────────────────────────────────────
  const handleSelectVariant = (v: CachedVariant) => {
    setSelectedVariant(v);
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
          barcode:   scannedBarcode,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        navigator.vibrate?.(100);
        setProducts(prev =>
          prev.map(product => ({
            ...product,
            variants: product.variants.map(v =>
              v.variantId === selectedVariant.variantId ? { ...v, barcode: scannedBarcode } : v
            ),
          }))
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
    ? new Date(lastSync).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <main className="min-h-screen flex flex-col bg-slate-950">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-slate-900 border-b border-slate-800 sticky top-0 z-10">
        <button
          onClick={() => step === "list" ? router.push("/") : handleReset()}
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

      {/* Step indicator */}
      {step !== "list" && step !== "done" && (
        <div className="flex items-center gap-2 px-4 py-2 bg-slate-900/50 border-b border-slate-800/50">
          {(["scan", "confirm"] as const).map((s, i) => {
            const active = step === s || (step === "saving" && s === "confirm");
            const done   = s === "scan" && (step === "confirm" || step === "saving");
            return (
              <div key={s} className="flex items-center gap-2">
                {i > 0 && <div className="w-6 h-px bg-slate-700" />}
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                  active ? "bg-purple-600 text-white" : done ? "bg-purple-900/50 text-purple-400" : "bg-slate-800 text-slate-500"
                }`}>{i + 1}</div>
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
          <StatusBanner type={banner.type} message={banner.message} autoDismiss={4000} onDismiss={() => setBanner(null)} />
        )}

        {/* ── List ──────────────────────────────────────────────────────── */}
        {step === "list" && (
          <>
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder="Search by name, SKU or barcode…"
                className="w-full pl-10 pr-10 py-3 bg-slate-900 border border-slate-700 rounded-xl text-slate-100 placeholder-slate-500 text-base focus:outline-none focus:ring-2 focus:ring-purple-500 min-h-[48px]"
              />
              {searchInput && (
                <button
                  onClick={() => { setSearchInput(""); pushFilters("", urlVendor, urlHasBarcode, urlStatus); }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Filter row */}
            <div className="flex flex-wrap gap-2">
              {/* Barcode filter */}
              <div className="flex rounded-lg overflow-hidden border border-slate-700 text-xs font-medium">
                {(["all", "yes", "no"] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => handleHasBarcodeChange(v)}
                    className={`px-3 py-2 transition-colors min-h-[36px] ${
                      urlHasBarcode === v ? "bg-purple-700 text-white" : "bg-slate-900 text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    {v === "all" ? "All" : v === "yes" ? "Has barcode" : "No barcode"}
                  </button>
                ))}
              </div>

              {/* Status filter */}
              <div className="flex rounded-lg overflow-hidden border border-slate-700 text-xs font-medium">
                {([
                  { value: "all",      label: "Any status" },
                  { value: "ACTIVE",   label: "Active" },
                  { value: "DRAFT",    label: "Draft" },
                  { value: "ARCHIVED", label: "Archived" },
                ] as const).map(({ value, label }) => (
                  <button
                    key={value}
                    onClick={() => handleStatusChange(value)}
                    className={`px-3 py-2 transition-colors min-h-[36px] ${
                      urlStatus === value ? "bg-purple-700 text-white" : "bg-slate-900 text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Vendor filter */}
              {vendors.length > 0 && (
                <div className="relative">
                  <Filter className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
                  <select
                    value={urlVendor}
                    onChange={(e) => handleVendorChange(e.target.value)}
                    className="pl-8 pr-7 py-2 bg-slate-900 border border-slate-700 rounded-lg text-slate-300 text-xs appearance-none focus:outline-none focus:ring-2 focus:ring-purple-500 min-h-[36px]"
                  >
                    <option value="all">All vendors</option>
                    {vendors.map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                  <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
                </div>
              )}
            </div>

            {/* Stats */}
            {!loading && (
              <div className="flex items-center justify-between text-xs text-slate-500 px-1">
                <span>
                  {total} product{total !== 1 ? "s" : ""}
                  {missingCount > 0 && <span className="text-orange-400 ml-2">· {missingCount} without barcode</span>}
                </span>
                {formattedLastSync && <span>Synced {formattedLastSync}</span>}
              </div>
            )}

            {/* Loading */}
            {loading && (
              <div className="flex items-center justify-center py-12">
                <div className="flex gap-2">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="w-2 h-2 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: `${i * 150}ms` }} />
                  ))}
                </div>
              </div>
            )}

            {/* Empty — never synced */}
            {!loading && total === 0 && vendors.length === 0 && (
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

            {/* Empty — filter has no results */}
            {!loading && total === 0 && vendors.length > 0 && (
              <div className="flex flex-col items-center justify-center py-10 text-slate-500 gap-2">
                <Search className="w-10 h-10 opacity-30" />
                <p className="text-sm">No variants match your filters</p>
              </div>
            )}

            {/* Product list */}
            {!loading && products.length > 0 && (
              <div className="space-y-2">
                {products.map((product) => {
                  const isSingleDefault =
                    product.variants.length === 1 &&
                    product.variants[0].variantTitle === "Default Title";

                  if (isSingleDefault) {
                    const v  = product.variants[0];
                    const cv = toCachedVariant(product, v);
                    return (
                      <ProductRow
                        key={product.productId}
                        product={product}
                        variant={v}
                        onClick={() => handleSelectVariant(cv)}
                      />
                    );
                  }

                  const isExpanded = expandedProducts.has(product.productId);
                  return (
                    <div key={product.productId} className="rounded-xl overflow-hidden border border-slate-700">
                      {/* Product header */}
                      <button
                        onClick={() => toggleExpand(product.productId)}
                        className="w-full flex items-center gap-3 p-3 bg-slate-900 hover:bg-slate-800 transition-colors text-left"
                      >
                        {product.imageUrl ? (
                          <div className="relative w-12 h-12 rounded-lg overflow-hidden bg-slate-800 shrink-0">
                            <Image src={product.imageUrl} alt={product.productTitle} fill className="object-cover" sizes="48px" />
                          </div>
                        ) : (
                          <div className="w-12 h-12 rounded-lg bg-slate-800 flex items-center justify-center shrink-0">
                            <span className="text-xl">📦</span>
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-slate-100 text-sm leading-tight truncate">
                            {product.productTitle}
                          </p>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            {product.vendor && (
                              <span className="text-xs text-slate-500">{product.vendor}</span>
                            )}
                            <StatusBadge status={product.status} />
                            <span className="text-xs text-slate-500">
                              {product.variants.length} variant{product.variants.length !== 1 ? "s" : ""}
                            </span>
                          </div>
                        </div>
                        <ChevronDown
                          className={`w-4 h-4 text-slate-500 shrink-0 transition-transform duration-200 ${isExpanded ? "" : "-rotate-90"}`}
                        />
                      </button>

                      {/* Expanded variants */}
                      {isExpanded && (
                        <div className="border-t border-slate-800">
                          {product.variants.map((v, i) => {
                            const cv = toCachedVariant(product, v);
                            return (
                              <button
                                key={v.variantId}
                                onClick={() => handleSelectVariant(cv)}
                                className={`w-full flex items-center gap-3 px-4 py-3 bg-slate-950 hover:bg-slate-900 transition-colors text-left ${
                                  i < product.variants.length - 1 ? "border-b border-slate-800/60" : ""
                                }`}
                              >
                                <div className="w-8 h-8 rounded-md bg-slate-800/60 flex items-center justify-center shrink-0">
                                  <Tag className="w-3.5 h-3.5 text-slate-600" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm text-slate-200 font-medium truncate">{v.variantTitle}</p>
                                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                    {v.sku && <span className="text-xs font-mono text-slate-500">{v.sku}</span>}
                                    {v.barcode ? (
                                      <span className="text-xs px-1.5 py-0.5 bg-green-900/40 text-green-400 rounded border border-green-800/50">has barcode</span>
                                    ) : (
                                      <span className="text-xs px-1.5 py-0.5 bg-orange-900/40 text-orange-400 rounded border border-orange-800/50">no barcode</span>
                                    )}
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Load more */}
                {hasMore && (
                  <button
                    onClick={handleLoadMore}
                    disabled={loadingMore}
                    className="w-full py-3 bg-slate-900 border border-slate-700 hover:border-purple-500/50 hover:bg-slate-800 rounded-xl text-sm text-slate-400 transition-all flex items-center justify-center gap-2 min-h-[48px]"
                  >
                    {loadingMore ? (
                      <><RefreshCw className="w-4 h-4 animate-spin" />Loading…</>
                    ) : (
                      <><ChevronDown className="w-4 h-4" />Load more ({total - products.length} remaining)</>
                    )}
                  </button>
                )}
              </div>
            )}
          </>
        )}

        {/* ── Scan ──────────────────────────────────────────────────────── */}
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
                  {selectedVariant.variantTitle !== "Default Title" ? selectedVariant.variantTitle : selectedVariant.productTitle}
                </p>
                {selectedVariant.variantTitle !== "Default Title" && (
                  <p className="text-xs text-slate-500">{selectedVariant.productTitle}</p>
                )}
                {selectedVariant.barcode && (
                  <p className="text-xs text-orange-400 mt-0.5">Will replace: <span className="font-mono">{selectedVariant.barcode}</span></p>
                )}
              </div>
              <button onClick={handleReset} className="p-1.5 text-slate-500 hover:text-slate-300 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-slate-300 flex items-center gap-2">
                <ScanLine className="w-4 h-4 text-purple-400" />Scan the barcode label
              </p>
              <p className="text-xs text-slate-500">Point the camera at the product barcode or sticker.</p>
            </div>
            <BarcodeScanner onScan={onBarcodeScan} active={step === "scan"} />
          </>
        )}

        {/* ── Confirm ───────────────────────────────────────────────────── */}
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
                    {selectedVariant.variantTitle !== "Default Title" ? selectedVariant.variantTitle : selectedVariant.productTitle}
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

        {/* ── Done ──────────────────────────────────────────────────────── */}
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

      <SyncModal
        open={syncOpen}
        lastSync={lastSync}
        onClose={() => setSyncOpen(false)}
        onSynced={handleSynced}
        onError={handleSyncError}
      />
    </main>
  );
}

// ── Shared sub-components ─────────────────────────────────────────────────────

function StatusBadge({ status }: { status: "ACTIVE" | "DRAFT" | "ARCHIVED" }) {
  if (status === "ACTIVE") {
    return <span className="text-xs px-1.5 py-0.5 bg-green-900/40 text-green-400 rounded border border-green-800/50">Active</span>;
  }
  if (status === "DRAFT") {
    return <span className="text-xs px-1.5 py-0.5 bg-yellow-900/40 text-yellow-400 rounded border border-yellow-800/50">Draft</span>;
  }
  return <span className="text-xs px-1.5 py-0.5 bg-slate-700/40 text-slate-500 rounded border border-slate-600/50">Archived</span>;
}

function ProductRow({
  product,
  variant,
  onClick,
}: {
  product: AssignProduct;
  variant: AssignVariant;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 p-3 bg-slate-900 border border-slate-700 hover:border-purple-500/50 hover:bg-slate-800 rounded-xl transition-all duration-150 active:scale-[0.98] text-left"
    >
      {product.imageUrl ? (
        <div className="relative w-12 h-12 rounded-lg overflow-hidden bg-slate-800 shrink-0">
          <Image src={product.imageUrl} alt={product.productTitle} fill className="object-cover" sizes="48px" />
        </div>
      ) : (
        <div className="w-12 h-12 rounded-lg bg-slate-800 flex items-center justify-center shrink-0">
          <span className="text-xl">📦</span>
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="font-medium text-slate-100 text-sm leading-tight truncate">{product.productTitle}</p>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          {product.vendor && <span className="text-xs text-slate-500">{product.vendor}</span>}
          <StatusBadge status={product.status} />
          {variant.sku && <span className="text-xs font-mono text-slate-500">{variant.sku}</span>}
          {variant.barcode ? (
            <span className="text-xs px-1.5 py-0.5 bg-green-900/40 text-green-400 rounded border border-green-800/50">has barcode</span>
          ) : (
            <span className="text-xs px-1.5 py-0.5 bg-orange-900/40 text-orange-400 rounded border border-orange-800/50">no barcode</span>
          )}
        </div>
      </div>
      <Tag className="w-4 h-4 text-slate-600 shrink-0" />
    </button>
  );
}

// Suspense wrapper required for useSearchParams in App Router
export default function AssignPage() {
  return (
    <Suspense fallback={null}>
      <AssignPageInner />
    </Suspense>
  );
}
