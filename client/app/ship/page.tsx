"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { StatusBanner } from "@/components/StatusBanner";
import { useScanner } from "@/hooks/useScanner";
import { ShipmentFulfillment, ShipmentLineItem, ShipmentScanRecord } from "@/lib/types";
import {
  ArrowLeft,
  RefreshCw,
  Search,
  X,
  CheckCircle2,
  Package,
  ChevronRight,
  ChevronDown,
  Truck,
  MapPin,
  Tag,
  Minus,
  Zap,
  ScanLine,
  Clock,
  User,
  Filter,
  AlertTriangle,
  ExternalLink,
  ArrowUp,
  ArrowDown,
  StickyNote,
} from "lucide-react";

type ActiveStep = "list" | "detail" | "scanning";
type ScanStep = "idle" | "confirm" | "extra-prompt";
type ExtraContext = "not-in-order" | "exceeded";
type ScanMode = "regular" | "fast";
type HistoryType = "all" | "complete" | "incomplete";

interface Banner {
  type: "success" | "error" | "warning" | "info";
  message: string;
}

interface HistoryFilters {
  from: string;
  to: string;
  scannedBy: string;
  type: HistoryType;
}

interface QrLabel {
  plu: string;
  productTitle: string;
  itemWeight: string;
  printedAt: string;
  sn: string;
  weightGrams: number | null;
}

// ─── Scale & Print QR payload: "<PLU> | <Product Title> | <Item Weight> | <Printed At> | SN:<sn>" ──
function parseQrLabel(value: string): QrLabel | null {
  const parts = value.split("|").map((p) => p.trim());
  if (parts.length !== 5) return null;
  const [plu, productTitle, itemWeight, printedAt, snPart] = parts;
  const snMatch = snPart.match(/^SN:(.+)$/i);
  if (!snMatch || !plu || !productTitle) return null;

  let weightGrams: number | null = null;
  const weightMatch = itemWeight.match(/(\d+\.?\d*)\s*(kg|g|lb)\b/i);
  if (weightMatch) {
    const value = parseFloat(weightMatch[1]);
    const unit = weightMatch[2].toLowerCase();
    weightGrams = unit === "kg" ? value * 1000 : unit === "lb" ? value * 453.592 : value;
  }

  return { plu, productTitle, itemWeight, printedAt, sn: snMatch[1], weightGrams };
}

function formatWeightGrams(grams: number | null): string {
  if (grams == null) return "";
  return `${(grams / 453.592).toFixed(2)} lb`;
}

export default function ShipPage() {
  const router = useRouter();
  const { handleScan: debounceScan, playBeep } = useScanner();

  // ─── Tab ─────────────────────────────────────────────────────────────────────
  const [tab, setTab] = useState<"active" | "history">("active");

  // ─── Active tab state ─────────────────────────────────────────────────────────
  const [activeStep, setActiveStep] = useState<ActiveStep>("list");
  const [fulfillments, setFulfillments] = useState<ShipmentFulfillment[]>([]);
  const [loadingFulfillments, setLoadingFulfillments] = useState(true);
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncFiltersOpen, setSyncFiltersOpen] = useState(false);
  const [syncRange, setSyncRange] = useState({ from: "", to: "" });
  const [pendingSyncRange, setPendingSyncRange] = useState({ from: "", to: "" });
  const [filterText, setFilterText] = useState("");
  const [orderSort, setOrderSort] = useState<"asc" | "desc">("desc");
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectedFulfillment, setSelectedFulfillment] = useState<ShipmentFulfillment | null>(null);
  const [banner, setBanner] = useState<Banner | null>(null);

  // ─── Scan confirmation flow ────────────────────────────────────────────────────
  const [scanMode, setScanMode] = useState<ScanMode>("regular");
  const [scanStep, setScanStep] = useState<ScanStep>("idle");
  const [pendingBarcode, setPendingBarcode] = useState("");
  const [pendingItem, setPendingItem] = useState<ShipmentLineItem | null>(null);
  const [pendingQr, setPendingQr] = useState<QrLabel | null>(null);
  const [extraContext, setExtraContext] = useState<ExtraContext>("not-in-order");
  const [extraReason, setExtraReason] = useState("");
  // Reason entered once per barcode/PLU is remembered for the rest of the scanning session,
  // so repeat over-scans of the same item don't re-prompt — they just keep adding like a normal scan.
  const rememberedExtraReasonsRef = useRef<Map<string, string>>(new Map());
  const [extraLoading, setExtraLoading] = useState(false);

  // ─── Complete modal ───────────────────────────────────────────────────────────
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [completeReason, setCompleteReason] = useState("");
  const [completeLoading, setCompleteLoading] = useState(false);
  const [completeStaffName, setCompleteStaffName] = useState("");

  // ─── Staff name ───────────────────────────────────────────────────────────────
  const [staffName, setStaffName] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [showNamePrompt, setShowNamePrompt] = useState(false);
  const [showSessionPrompt, setShowSessionPrompt] = useState(false);

  // ─── History tab state ────────────────────────────────────────────────────────
  const [historyFulfillments, setHistoryFulfillments] = useState<ShipmentFulfillment[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyFilters, setHistoryFilters] = useState<HistoryFilters>({
    from: "",
    to: "",
    scannedBy: "",
    type: "all",
  });
  const [historyFiltersOpen, setHistoryFiltersOpen] = useState(false);
  const [pendingFilters, setPendingFilters] = useState<HistoryFilters>({
    from: "",
    to: "",
    scannedBy: "",
    type: "all",
  });

  // ─── History detail ───────────────────────────────────────────────────────────
  const [selectedHistory, setSelectedHistory] = useState<ShipmentFulfillment | null>(null);
  const [historyScans, setHistoryScans] = useState<ShipmentScanRecord[]>([]);
  const [historyScansLoading, setHistoryScansLoading] = useState(false);
  const [expandedHistoryItems, setExpandedHistoryItems] = useState<Set<string>>(new Set());

  const didFetch = useRef(false);

  // ─── Load staff name from localStorage; confirm once per session ──────────────
  useEffect(() => {
    const saved = localStorage.getItem("shipscan_staff_name");
    if (saved) {
      setStaffName(saved);
      setCompleteStaffName(saved);
      if (!sessionStorage.getItem("shipscan_session_started")) {
        setShowSessionPrompt(true);
      }
    } else {
      setShowNamePrompt(true);
    }
  }, []);

  // ─── Fetch fulfillments ────────────────────────────────────────────────────────
  const fetchFulfillments = useCallback(async () => {
    setLoadingFulfillments(true);
    try {
      const res = await fetch("/api/ship-orders");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load orders");
      setFulfillments(data.fulfillments ?? []);
    } catch (e) {
      setBanner({ type: "error", message: e instanceof Error ? e.message : "Failed to load orders" });
    } finally {
      setLoadingFulfillments(false);
    }
  }, []);

  useEffect(() => {
    if (didFetch.current) return;
    didFetch.current = true;
    fetchFulfillments();
  }, [fetchFulfillments]);

  // ─── Sync from Shopify ─────────────────────────────────────────────────────────
  const handleSync = useCallback(async (range?: { from: string; to: string }) => {
    setSyncLoading(true);
    setBanner(null);
    try {
      const params = new URLSearchParams();
      if (range?.from) params.set("from", range.from);
      if (range?.to) params.set("to", range.to);
      const qs = params.toString();

      const res = await fetch(`/api/sync/ship-orders${qs ? `?${qs}` : ""}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Sync failed");

      await fetchFulfillments();
      setBanner({ type: "success", message: `Synced ${data.synced ?? 0} fulfillment(s) from Shopify` });
    } catch (e) {
      setBanner({ type: "error", message: e instanceof Error ? e.message : "Sync failed" });
    } finally {
      setSyncLoading(false);
    }
  }, [fetchFulfillments]);

  // ─── Search Shopify directly for an order not yet in the local list ─────────────
  const handleSearchShopify = useCallback(async () => {
    const ref = filterText.trim();
    if (!ref) return;
    setSearchLoading(true);
    setBanner(null);
    try {
      const res = await fetch(`/api/ship-orders/lookup?ref=${encodeURIComponent(ref)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lookup failed");

      if (!data.found) {
        setBanner({ type: "warning", message: `Order "${ref}" not found` });
        return;
      }

      if (data.warning) {
        setBanner({
          type: "warning",
          message:
            data.warning === "unfulfilled"
              ? `${data.orderName} is still unfulfilled — sync may be incomplete`
              : `${data.orderName} has no tracking info yet`,
        });
      }

      const incoming = (data.fulfillments ?? []) as ShipmentFulfillment[];
      setFulfillments((prev) => {
        const merged = [...prev];
        for (const f of incoming) {
          const idx = merged.findIndex((m) => m.fulfillmentId === f.fulfillmentId);
          if (idx >= 0) merged[idx] = f;
          else merged.push(f);
        }
        return merged;
      });
      setBanner({ type: "success", message: `Found ${data.orderName}` });
    } catch (e) {
      setBanner({ type: "error", message: e instanceof Error ? e.message : "Lookup failed" });
    } finally {
      setSearchLoading(false);
    }
  }, [filterText]);

  // ─── Apply a quantity/status update to the selected + list fulfillments ───────
  const applyLineItemUpdate = useCallback((
    fulfillmentId: string,
    status: "pending" | "partial" | "shipped",
    fulfillmentLineItemId: string,
    quantityShipped: number,
    extraItem?: ShipmentLineItem,
  ) => {
    setSelectedFulfillment((prev) => {
      if (!prev) return prev;
      let lineItems = prev.lineItems.map((li) =>
        li.fulfillmentLineItemId === fulfillmentLineItemId
          ? { ...li, quantityShipped }
          : li
      );
      if (extraItem) {
        const existingIdx = lineItems.findIndex((li) => li.fulfillmentLineItemId === extraItem.fulfillmentLineItemId);
        if (existingIdx >= 0) lineItems[existingIdx] = extraItem;
        else lineItems = [...lineItems, extraItem];
      }
      const updated = { ...prev, status, lineItems };
      setFulfillments((all) =>
        all.map((f) => (f.fulfillmentId === fulfillmentId ? updated : f))
      );
      return updated;
    });
  }, []);

  // ─── Save a free-text note on an order, for either the Active detail or History detail view ──
  const saveFulfillmentNotes = useCallback(async (fulfillmentId: string, notes: string, target: "active" | "history") => {
    try {
      const res = await fetch("/api/shipment/notes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fulfillmentId, notes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save note");
      const saved: string = data.notes ?? notes;
      if (target === "active") {
        setSelectedFulfillment((prev) => (prev && prev.fulfillmentId === fulfillmentId ? { ...prev, notes: saved } : prev));
        setFulfillments((all) => all.map((f) => (f.fulfillmentId === fulfillmentId ? { ...f, notes: saved } : f)));
      } else {
        setSelectedHistory((prev) => (prev && prev.fulfillmentId === fulfillmentId ? { ...prev, notes: saved } : prev));
        setHistoryFulfillments((all) => all.map((f) => (f.fulfillmentId === fulfillmentId ? { ...f, notes: saved } : f)));
      }
    } catch (e) {
      setBanner({ type: "error", message: e instanceof Error ? e.message : "Failed to save note" });
    }
  }, []);

  // ─── Record a scan against a matched line item ────────────────────────────────
  const performScan = useCallback(async (item: ShipmentLineItem, qr: QrLabel | null) => {
    if (!selectedFulfillment) return;

    try {
      const res = await fetch("/api/shipment/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fulfillmentId: selectedFulfillment.fulfillmentId,
          fulfillmentLineItemId: item.fulfillmentLineItemId,
          barcode: qr ? qr.plu : item.barcode,
          scannedBy: staffName,
          ...(qr ? {
            plu: qr.plu,
            qrSn: qr.sn,
            packagedAt: qr.printedAt,
            weightGrams: qr.weightGrams,
            isVariableWeight: true,
          } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Scan failed");

      if (data.duplicate) {
        setBanner({ type: "warning", message: "This label was already scanned" });
        return;
      }
      if (!data.matched) {
        setBanner({ type: "warning", message: "Barcode not found in this shipment" });
        return;
      }
      if (data.alreadyFull) {
        setBanner({ type: "warning", message: `${data.lineItemName} already fully scanned` });
        return;
      }

      playBeep();
      navigator.vibrate?.(80);
      const weightSuffix = qr?.weightGrams != null ? ` (${formatWeightGrams(qr.weightGrams)})` : "";
      setBanner({
        type: "success",
        message: `${data.lineItemName} scanned${weightSuffix} (${data.quantityShipped}/${data.quantityExpected})`,
      });

      applyLineItemUpdate(
        selectedFulfillment.fulfillmentId,
        data.fulfillmentStatus,
        data.fulfillmentLineItemId,
        data.quantityShipped,
      );
    } catch (e) {
      setBanner({ type: "error", message: e instanceof Error ? e.message : "Scan failed" });
    }
  }, [selectedFulfillment, staffName, playBeep, applyLineItemUpdate]);

  // ─── Item not in this order / over quantity — submit as an extra with a reason ─
  // Shared by the manual "Accept" button and by silent repeat-scans that reuse a
  // previously-entered reason for the same barcode (see rememberedExtraReasonsRef).
  const submitExtra = useCallback(async (barcodeValue: string, qr: QrLabel | null, reason: string) => {
    if (!selectedFulfillment || !reason.trim()) return;
    setExtraLoading(true);
    try {
      const res = await fetch("/api/shipment/scan-extra", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fulfillmentId: selectedFulfillment.fulfillmentId,
          barcode: barcodeValue,
          reason: reason.trim(),
          scannedBy: staffName,
          ...(qr ? {
            plu: qr.plu,
            qrSn: qr.sn,
            packagedAt: qr.printedAt,
            weightGrams: qr.weightGrams,
          } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add item");

      if (data.duplicate) {
        setBanner({ type: "warning", message: "This label was already scanned" });
        return;
      }

      playBeep();
      navigator.vibrate?.(80);
      const weightSuffix = qr?.weightGrams != null ? ` (${formatWeightGrams(qr.weightGrams)})` : "";
      setBanner({ type: "success", message: `${data.productTitle} added as extra item${weightSuffix}` });

      const extraItem: ShipmentLineItem = {
        fulfillmentLineItemId: data.fulfillmentLineItemId,
        lineItemId: "",
        name: data.productTitle,
        quantityExpected: data.quantityExpected,
        quantityShipped: data.quantityShipped,
        variantId: null,
        sku: data.sku ?? null,
        barcode: data.barcode ?? barcodeValue,
        productTitle: data.productTitle,
        variantTitle: data.variantTitle ?? null,
        imageUrl: data.imageUrl ?? null,
        price: data.price ?? "0.00",
        weight: data.weight ?? null,
        weightUnit: data.weightUnit ?? null,
        isExtra: true,
        addedReason: reason.trim(),
        addedBy: staffName,
      };
      applyLineItemUpdate(selectedFulfillment.fulfillmentId, data.fulfillmentStatus, "__none__", 0, extraItem);
      rememberedExtraReasonsRef.current.set(barcodeValue.trim().toLowerCase(), reason.trim());
    } catch (e) {
      setBanner({ type: "error", message: e instanceof Error ? e.message : "Failed to add item" });
    } finally {
      setExtraLoading(false);
    }
  }, [selectedFulfillment, staffName, playBeep, applyLineItemUpdate]);

  // ─── Barcode (or printed QR label) detected ────────────────────────────────────
  const handleBarcodeDetected = useCallback((value: string) => {
    if (!selectedFulfillment || scanStep !== "idle") return;
    setBanner(null);

    const qr = parseQrLabel(value);
    const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

    const item = selectedFulfillment.lineItems.find((li) => {
      if (qr) {
        return (
          (li.barcode && norm(li.barcode) === norm(qr.plu)) ||
          norm(li.productTitle) === norm(qr.productTitle) ||
          norm(li.variantTitle) === norm(qr.productTitle)
        );
      }
      return (
        (li.barcode && norm(li.barcode) === norm(value)) ||
        (li.sku && norm(li.sku) === norm(value))
      );
    });

    const barcode = qr ? qr.plu : value;
    const rememberedReason = rememberedExtraReasonsRef.current.get(barcode.trim().toLowerCase());

    if (!item) {
      if (rememberedReason) {
        submitExtra(barcode, qr, rememberedReason);
        return;
      }
      setPendingBarcode(barcode);
      setPendingQr(qr);
      setPendingItem(null);
      setExtraReason("");
      setExtraContext("not-in-order");
      setScanStep("extra-prompt");
      return;
    }

    if (item.quantityShipped >= item.quantityExpected) {
      if (rememberedReason) {
        submitExtra(barcode, qr, rememberedReason);
        return;
      }
      setPendingBarcode(barcode);
      setPendingQr(qr);
      setPendingItem(item);
      setExtraReason("");
      setExtraContext("exceeded");
      setScanStep("extra-prompt");
      return;
    }

    if (scanMode === "fast") {
      performScan(item, qr);
      return;
    }

    setPendingBarcode(barcode);
    setPendingQr(qr);
    setPendingItem(item);
    setScanStep("confirm");
  }, [selectedFulfillment, scanStep, scanMode, performScan, submitExtra]);

  // ─── Staff confirms a regular-mode scan ────────────────────────────────────────
  const handleConfirmScan = useCallback(async () => {
    const item = pendingItem;
    const qr = pendingQr;
    setScanStep("idle");
    setPendingBarcode("");
    setPendingItem(null);
    setPendingQr(null);
    if (item) await performScan(item, qr);
  }, [pendingItem, pendingQr, performScan]);

  const handleCancelScan = useCallback(() => {
    setScanStep("idle");
    setPendingBarcode("");
    setPendingItem(null);
    setPendingQr(null);
    setExtraReason("");
  }, []);

  const handleAcceptExtra = useCallback(async () => {
    if (!extraReason.trim()) return;
    await submitExtra(pendingBarcode, pendingQr, extraReason);
    setScanStep("idle");
    setPendingBarcode("");
    setPendingItem(null);
    setPendingQr(null);
    setExtraReason("");
  }, [pendingBarcode, pendingQr, extraReason, submitExtra]);

  const handleDeclineExtra = useCallback(() => {
    setBanner({ type: "info", message: "Scan discarded — item not added" });
    setScanStep("idle");
    setPendingBarcode("");
    setPendingQr(null);
    setPendingItem(null);
    setExtraReason("");
  }, []);

  // ─── Decrement a packed item ───────────────────────────────────────────────────
  const handleDecrement = useCallback(async (li: ShipmentLineItem) => {
    if (!selectedFulfillment || li.quantityShipped <= 0) return;
    setBanner(null);

    try {
      const res = await fetch("/api/shipment/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fulfillmentId: selectedFulfillment.fulfillmentId,
          fulfillmentLineItemId: li.fulfillmentLineItemId,
          scannedBy: staffName,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to remove item");

      navigator.vibrate?.(50);
      setBanner({ type: "info", message: `${li.productTitle} decreased to ${data.quantityShipped}/${data.quantityExpected}` });

      applyLineItemUpdate(
        selectedFulfillment.fulfillmentId,
        data.fulfillmentStatus,
        data.fulfillmentLineItemId,
        data.quantityShipped,
      );
    } catch (e) {
      setBanner({ type: "error", message: e instanceof Error ? e.message : "Failed to remove item" });
    }
  }, [selectedFulfillment, staffName, applyLineItemUpdate]);

  // ─── Complete shipment ────────────────────────────────────────────────────────
  const handleComplete = useCallback(async () => {
    if (!selectedFulfillment) return;
    setCompleteLoading(true);

    try {
      const res = await fetch("/api/shipment/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fulfillmentId: selectedFulfillment.fulfillmentId,
          scannedBy: completeStaffName || staffName,
          reason: completeReason || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to complete shipment");

      playBeep();
      navigator.vibrate?.([80, 50, 80]);

      setFulfillments((prev) =>
        prev.filter((f) => f.fulfillmentId !== selectedFulfillment.fulfillmentId)
      );
      setShowCompleteModal(false);
      setCompleteReason("");
      setSelectedFulfillment(null);
      setActiveStep("list");
    } catch (e) {
      setBanner({ type: "error", message: e instanceof Error ? e.message : "Failed to complete shipment" });
      setShowCompleteModal(false);
    } finally {
      setCompleteLoading(false);
    }
  }, [selectedFulfillment, completeStaffName, staffName, completeReason, playBeep]);

  // ─── Fetch history ─────────────────────────────────────────────────────────────
  const fetchHistory = useCallback(async (filters: HistoryFilters) => {
    setHistoryLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.from) params.set("from", filters.from);
      if (filters.to) params.set("to", filters.to + "T23:59:59");
      if (filters.scannedBy) params.set("scannedBy", filters.scannedBy);
      if (filters.type === "incomplete") params.set("type", "incomplete");
      if (filters.type === "complete") params.set("type", "complete");

      const res = await fetch(`/api/shipment/history?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load history");
      setHistoryFulfillments(data.shipments ?? []);
    } catch (e) {
      setBanner({ type: "error", message: e instanceof Error ? e.message : "Failed to load history" });
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const fetchHistoryScans = useCallback(async (fulfillmentId: string) => {
    setHistoryScansLoading(true);
    setHistoryScans([]);
    try {
      const res = await fetch(`/api/shipment/scans?fulfillmentId=${encodeURIComponent(fulfillmentId)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load scans");
      setHistoryScans(data.scans ?? []);
    } catch {
      // Non-critical
    } finally {
      setHistoryScansLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "history") fetchHistory(historyFilters);
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Helpers ──────────────────────────────────────────────────────────────────
  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString("en-CA", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  const formatDateShort = (iso: string) =>
    new Date(iso).toLocaleDateString("en-CA", { month: "short", day: "numeric" });

  const getTotals = (f: ShipmentFulfillment) => {
    const expected = f.lineItems.reduce((s, li) => s + li.quantityExpected, 0);
    const shipped = f.lineItems.reduce((s, li) => s + li.quantityShipped, 0);
    return { expected, shipped };
  };

  const activeFilterCount = [
    historyFilters.from,
    historyFilters.to,
    historyFilters.scannedBy,
    historyFilters.type !== "all" ? historyFilters.type : "",
  ].filter(Boolean).length;

  // ─── Top bar ──────────────────────────────────────────────────────────────────
  const renderTopBar = (title: string, onBack?: () => void, right?: React.ReactNode) => (
    <div className="flex items-center justify-between px-4 py-3 bg-slate-900 border-b border-slate-800 shrink-0">
      <button
        onClick={onBack ?? (() => router.push("/"))}
        className="p-2 -ml-2 text-slate-400 hover:text-slate-200 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
      >
        <ArrowLeft className="w-5 h-5" />
      </button>
      <h1 className="font-bold text-slate-100">{title}</h1>
      <div className="min-w-[44px] flex justify-end">{right ?? <div className="w-9" />}</div>
    </div>
  );

  // ─── Staff name prompt ────────────────────────────────────────────────────────
  if (showNamePrompt) {
    return (
      <main className="min-h-screen flex flex-col bg-slate-950">
        {renderTopBar("Ship Mode")}
        <div className="flex-1 flex items-end">
          <div className="w-full bg-slate-900 border-t border-slate-700 rounded-t-2xl p-6 space-y-4">
            <div className="flex items-center gap-3">
              <User className="w-6 h-6 text-green-400 shrink-0" />
              <div>
                <h2 className="text-lg font-bold text-slate-100">Who is shipping today?</h2>
                <p className="text-sm text-slate-400">Your name will be recorded on each shipment</p>
              </div>
            </div>
            <input
              type="text"
              placeholder="Enter your name"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && nameInput.trim()) {
                  const name = nameInput.trim();
                  setStaffName(name);
                  setCompleteStaffName(name);
                  localStorage.setItem("shipscan_staff_name", name);
                  sessionStorage.setItem("shipscan_session_started", "1");
                  setShowNamePrompt(false);
                }
              }}
              autoFocus
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-green-600"
            />
            <button
              onClick={() => {
                const name = nameInput.trim();
                if (!name) return;
                setStaffName(name);
                setCompleteStaffName(name);
                localStorage.setItem("shipscan_staff_name", name);
                sessionStorage.setItem("shipscan_session_started", "1");
                setShowNamePrompt(false);
              }}
              disabled={!nameInput.trim()}
              className="w-full py-3 bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white font-semibold rounded-xl transition-colors"
            >
              Start Shipping
            </button>
          </div>
        </div>
      </main>
    );
  }

  // ─── Once-per-session staff name confirmation ─────────────────────────────────
  if (showSessionPrompt) {
    return (
      <main className="min-h-screen flex flex-col bg-slate-950">
        {renderTopBar("Ship Mode")}
        <div className="flex-1 flex items-end">
          <div className="w-full bg-slate-900 border-t border-slate-700 rounded-t-2xl p-6 space-y-4">
            <div className="flex items-center gap-3">
              <User className="w-6 h-6 text-green-400 shrink-0" />
              <div>
                <h2 className="text-lg font-bold text-slate-100">Continue as {staffName}?</h2>
                <p className="text-sm text-slate-400">This name will be recorded on shipments this session</p>
              </div>
            </div>
            <button
              onClick={() => {
                sessionStorage.setItem("shipscan_session_started", "1");
                setShowSessionPrompt(false);
              }}
              className="w-full py-3 bg-green-600 hover:bg-green-500 text-white font-semibold rounded-xl transition-colors"
            >
              Continue as {staffName}
            </button>
            <button
              onClick={() => {
                sessionStorage.setItem("shipscan_session_started", "1");
                setNameInput(staffName);
                setShowSessionPrompt(false);
                setShowNamePrompt(true);
              }}
              className="w-full py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-xl transition-colors"
            >
              Change Name
            </button>
          </div>
        </div>
      </main>
    );
  }

  // ─── Scanning step ────────────────────────────────────────────────────────────
  if (activeStep === "scanning" && selectedFulfillment) {
    return (
      <main className="min-h-screen flex flex-col bg-slate-950">
        {renderTopBar(
          `Scanning — ${selectedFulfillment.orderName}`,
          () => { setBanner(null); handleCancelScan(); setActiveStep("detail"); }
        )}
        <div className="flex-1 flex flex-col gap-4 p-4 overflow-y-auto">
          {/* Scan mode toggle */}
          <div className="flex items-center gap-1 bg-slate-800 rounded-lg p-0.5 self-center">
            <button
              onClick={() => setScanMode("regular")}
              disabled={scanStep !== "idle"}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 disabled:opacity-50 ${
                scanMode === "regular" ? "bg-green-600 text-white" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <ScanLine className="w-3.5 h-3.5" /> Regular
            </button>
            <button
              onClick={() => setScanMode("fast")}
              disabled={scanStep !== "idle"}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 disabled:opacity-50 ${
                scanMode === "fast" ? "bg-green-600 text-white" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Zap className="w-3.5 h-3.5" /> Fast Scan
            </button>
          </div>

          <p className="text-sm text-slate-400 text-center">
            {scanStep === "idle"
              ? "Point camera at barcode to scan"
              : scanStep === "confirm"
              ? "Confirm before recording"
              : extraContext === "exceeded"
              ? "This item has already reached its expected quantity"
              : "This item is not in this order"}
          </p>

          {banner && <StatusBanner type={banner.type} message={banner.message} />}

          {/* Scanner — stays active in fast mode, paused while a prompt is shown */}
          {scanStep === "idle" ? (
            <BarcodeScanner onScan={(value) => debounceScan(value, handleBarcodeDetected)} active={true} />
          ) : scanStep === "confirm" ? (
            <div className="flex flex-col gap-3">
              {/* Matched product */}
              <div className="bg-slate-900 border border-slate-700 rounded-xl p-3">
                {pendingItem && (
                  <div className="flex items-center gap-3">
                    {pendingItem.imageUrl && (
                      <img
                        src={pendingItem.imageUrl}
                        alt={pendingItem.productTitle}
                        className="w-10 h-10 rounded-lg object-cover shrink-0"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-100 truncate">{pendingItem.productTitle}</p>
                      {pendingItem.variantTitle && (
                        <p className="text-xs text-slate-400 truncate">{pendingItem.variantTitle}</p>
                      )}
                      <p className="text-xs text-slate-500 mt-0.5">
                        {pendingItem.quantityShipped}/{pendingItem.quantityExpected} → {pendingItem.quantityShipped + 1}/{pendingItem.quantityExpected}
                        {pendingQr?.weightGrams != null && ` · ${formatWeightGrams(pendingQr.weightGrams)}`}
                      </p>
                    </div>
                    <CheckCircle2 className="w-5 h-5 text-green-400 shrink-0" />
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex gap-2">
                <button
                  onClick={handleCancelScan}
                  className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmScan}
                  className="flex-[2] py-3 bg-green-600 hover:bg-green-500 active:bg-green-700 text-white font-semibold rounded-xl transition-colors"
                >
                  Confirm Scan
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="bg-amber-900/30 border border-amber-700 rounded-xl p-4 space-y-2">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-amber-200">
                      {extraContext === "exceeded"
                        ? `${pendingItem?.productTitle ?? "This item"} is already fully packed (${pendingItem?.quantityShipped}/${pendingItem?.quantityExpected})`
                        : pendingQr
                        ? `"${pendingQr.productTitle}" is not in this order`
                        : "This item is not in this order"}
                    </p>
                    <p className="text-xs text-amber-300/80 mt-0.5">
                      {pendingQr ? (
                        <>PLU <span className="font-mono">{pendingQr.plu}</span> · {pendingQr.itemWeight}</>
                      ) : (
                        <>Scanned barcode: <span className="font-mono">{pendingBarcode}</span></>
                      )}
                    </p>
                    <p className="text-xs text-amber-300/80 mt-1">
                      Pack one more anyway? A reason is required — it will be recorded as an extra item.
                    </p>
                  </div>
                </div>
                <textarea
                  value={extraReason}
                  onChange={(e) => setExtraReason(e.target.value)}
                  placeholder="Why is this item being added? (e.g. substitution, customer request, extra unit)"
                  rows={2}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500 resize-none"
                />
              </div>

              <div className="flex gap-2">
                <button
                  onClick={handleDeclineExtra}
                  className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-xl transition-colors"
                >
                  Decline
                </button>
                <button
                  onClick={handleAcceptExtra}
                  disabled={extraLoading || !extraReason.trim()}
                  className="flex-[2] py-3 bg-amber-600 hover:bg-amber-500 active:bg-amber-700 disabled:opacity-40 text-white font-semibold rounded-xl transition-colors"
                >
                  {extraLoading ? "Adding…" : "Accept & Add Item"}
                </button>
              </div>
            </div>
          )}

          {/* Progress summary */}
          {selectedFulfillment && (() => {
            const { shipped, expected } = getTotals(selectedFulfillment);
            const pct = expected > 0 ? Math.round((shipped / expected) * 100) : 0;
            return (
              <div className="bg-slate-900 border border-slate-700 rounded-xl p-3">
                <div className="flex justify-between text-xs text-slate-400 mb-1.5">
                  <span>Progress</span>
                  <span>{shipped}/{expected} items ({pct}%)</span>
                </div>
                <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-green-500 rounded-full transition-all duration-300"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })()}

          <button
            onClick={() => { setBanner(null); handleCancelScan(); setActiveStep("detail"); }}
            className="w-full py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-xl transition-colors"
          >
            Back to Order Details
          </button>
        </div>
      </main>
    );
  }

  // ─── Detail step ──────────────────────────────────────────────────────────────
  if (activeStep === "detail" && selectedFulfillment) {
    const { shipped, expected } = getTotals(selectedFulfillment);
    const pct = expected > 0 ? Math.round((shipped / expected) * 100) : 0;
    const allDone = shipped >= expected;

    const sortedItems = [...selectedFulfillment.lineItems].sort((a, b) => {
      const aDone = a.quantityShipped >= a.quantityExpected;
      const bDone = b.quantityShipped >= b.quantityExpected;
      if (aDone === bDone) return 0;
      return aDone ? 1 : -1;
    });

    return (
      <main className="min-h-screen flex flex-col bg-slate-950">
        {renderTopBar(
          selectedFulfillment.orderName,
          () => {
            setBanner(null);
            handleCancelScan();
            setSelectedFulfillment(null);
            setActiveStep("list");
          }
        )}

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 pb-36">
          {banner && <StatusBanner type={banner.type} message={banner.message} />}

          {/* Tracking info */}
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-4 space-y-2">
            <div className="flex items-center gap-2">
              <Truck className="w-4 h-4 text-green-400 shrink-0" />
              <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Tracking</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-sm text-slate-100 break-all">{selectedFulfillment.trackingNumber}</span>
              {selectedFulfillment.trackingUrl && (
                <a
                  href={selectedFulfillment.trackingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-green-400 shrink-0"
                >
                  Track <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
            {selectedFulfillment.trackingCarrier && (
              <span className="inline-flex text-xs px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-400">
                {selectedFulfillment.trackingCarrier}
              </span>
            )}
          </div>

          {/* Customer info */}
          {(selectedFulfillment.customerName || selectedFulfillment.shippingAddress) && (
            <div className="bg-slate-900 border border-slate-700 rounded-2xl p-4 space-y-1">
              <div className="flex items-center gap-2 mb-1">
                <MapPin className="w-4 h-4 text-slate-400 shrink-0" />
                <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Destination</span>
              </div>
              {selectedFulfillment.customerName && (
                <p className="text-sm text-slate-100 font-medium">{selectedFulfillment.customerName}</p>
              )}
              {selectedFulfillment.customerEmail && (
                <p className="text-xs text-slate-500">{selectedFulfillment.customerEmail}</p>
              )}
              {selectedFulfillment.shippingAddress && (
                <p className="text-xs text-slate-400">
                  {[
                    selectedFulfillment.shippingAddress.address1,
                    selectedFulfillment.shippingAddress.city,
                    selectedFulfillment.shippingAddress.provinceCode,
                    selectedFulfillment.shippingAddress.zip,
                  ].filter(Boolean).join(", ")}
                </p>
              )}
            </div>
          )}

          {/* Progress */}
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-4 space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-sm font-medium text-slate-300">
                {shipped} of {expected} items scanned
              </span>
              <span className={`text-sm font-bold ${allDone ? "text-green-400" : "text-yellow-400"}`}>
                {pct}%
              </span>
            </div>
            <div className="h-3 bg-slate-700 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${allDone ? "bg-green-500" : "bg-yellow-500"}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>

          {/* Tags */}
          {selectedFulfillment.orderTags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {selectedFulfillment.orderTags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-400"
                >
                  <Tag className="w-3 h-3" />
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Notes */}
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-4 space-y-2">
            <div className="flex items-center gap-2">
              <StickyNote className="w-4 h-4 text-slate-400 shrink-0" />
              <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Notes</span>
            </div>
            <textarea
              key={selectedFulfillment.fulfillmentId}
              defaultValue={selectedFulfillment.notes ?? ""}
              onBlur={(e) => {
                const value = e.target.value.trim();
                if (value !== (selectedFulfillment.notes ?? "")) {
                  saveFulfillmentNotes(selectedFulfillment.fulfillmentId, value, "active");
                }
              }}
              placeholder="e.g. added extra items, price issue, item damaged…"
              rows={2}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 resize-none focus:outline-none focus:ring-2 focus:ring-green-600"
            />
          </div>

          {/* Line items */}
          <div className="space-y-2">
            <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">Line Items</p>
            {sortedItems.map((li) => {
              const done = li.quantityShipped >= li.quantityExpected;
              return (
                <div
                  key={li.fulfillmentLineItemId}
                  className={`bg-slate-900 border rounded-xl p-3 flex items-center gap-3 transition-colors ${
                    done ? "border-green-800/50 bg-green-950/20" : "border-slate-700"
                  }`}
                >
                  {li.imageUrl ? (
                    <img
                      src={li.imageUrl}
                      alt={li.productTitle}
                      className="w-12 h-12 rounded-lg object-cover bg-slate-800 shrink-0"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-lg bg-slate-800 flex items-center justify-center shrink-0">
                      <Package className="w-6 h-6 text-slate-500" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-100 leading-tight truncate">
                      {li.productTitle}
                    </p>
                    {li.variantTitle && (
                      <p className="text-xs text-slate-400 truncate">{li.variantTitle}</p>
                    )}
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span
                        className={`text-xs font-mono px-2 py-0.5 rounded-full border ${
                          done
                            ? "bg-green-900/40 border-green-700 text-green-300"
                            : "bg-slate-800 border-slate-600 text-slate-300"
                        }`}
                      >
                        {li.quantityShipped}/{li.quantityExpected}
                      </span>
                      {li.sku && (
                        <span className="text-xs text-slate-600 truncate">{li.sku}</span>
                      )}
                      {li.isExtra && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-amber-900/40 border border-amber-700 text-amber-300">
                          Extra
                        </span>
                      )}
                    </div>
                    {li.isExtra && li.addedReason && (
                      <p className="text-xs text-amber-400/80 mt-1 truncate">
                        {li.addedReason}{li.addedBy ? ` — ${li.addedBy}` : ""}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {li.quantityShipped > 0 && (
                      <button
                        onClick={() => handleDecrement(li)}
                        className="p-2 bg-slate-800 hover:bg-slate-700 border border-slate-600 rounded-lg text-slate-300 transition-colors"
                        title="Remove one"
                      >
                        <Minus className="w-4 h-4" />
                      </button>
                    )}
                    {done && <CheckCircle2 className="w-5 h-5 text-green-400" />}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Bottom actions */}
        <div className="fixed bottom-0 left-0 right-0 bg-slate-950 border-t border-slate-800 p-4 space-y-2">
          <button
            onClick={() => { setBanner(null); rememberedExtraReasonsRef.current.clear(); setActiveStep("scanning"); }}
            className="w-full py-3 bg-green-600 hover:bg-green-500 active:bg-green-700 text-white font-semibold rounded-xl transition-colors"
          >
            Scan Barcode
          </button>
          <button
            onClick={() => {
              setCompleteReason("");
              setCompleteStaffName(staffName);
              setShowCompleteModal(true);
            }}
            className={`w-full py-3 font-semibold rounded-xl transition-colors ${
              allDone
                ? "bg-slate-700 hover:bg-slate-600 text-slate-100"
                : "bg-orange-900/60 hover:bg-orange-800/60 border border-orange-700 text-orange-200"
            }`}
          >
            {allDone ? "Mark as Shipped" : "Mark as Shipped (Incomplete)"}
          </button>
        </div>

        {/* Complete modal */}
        {showCompleteModal && (
          <div
            className="fixed inset-0 bg-black/70 flex items-end justify-center z-50"
            onClick={() => setShowCompleteModal(false)}
          >
            <div
              className="bg-slate-900 border border-slate-700 rounded-t-2xl w-full max-w-md p-6 space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-lg font-bold text-slate-100">
                {allDone ? "Confirm Shipment" : "Incomplete Shipment"}
              </h2>

              {!allDone && (
                <div className="flex items-start gap-3 bg-orange-900/30 border border-orange-700 rounded-xl p-3">
                  <AlertTriangle className="w-5 h-5 text-orange-400 shrink-0 mt-0.5" />
                  <div className="text-sm text-orange-200">
                    <p className="font-medium">Not all items scanned</p>
                    <p className="text-orange-300 mt-0.5">
                      {expected - shipped} item{expected - shipped !== 1 ? "s" : ""} missing.
                      A reason is required.
                    </p>
                  </div>
                </div>
              )}

              <div className="space-y-1">
                <label className="text-xs text-slate-400 uppercase tracking-wider">Staff Name</label>
                <input
                  type="text"
                  value={completeStaffName}
                  onChange={(e) => setCompleteStaffName(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-slate-100 focus:outline-none focus:border-green-600 text-sm"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs text-slate-400 uppercase tracking-wider">
                  {allDone ? "Notes (optional)" : "Reason (required)"}
                </label>
                <textarea
                  value={completeReason}
                  onChange={(e) => setCompleteReason(e.target.value)}
                  placeholder={allDone ? "Optional shipping notes…" : "Why are items missing?"}
                  rows={3}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-green-600 text-sm resize-none"
                />
              </div>

              <button
                onClick={handleComplete}
                disabled={completeLoading || (!allDone && !completeReason.trim())}
                className={`w-full py-3 font-semibold rounded-xl transition-colors disabled:opacity-40 ${
                  allDone
                    ? "bg-green-600 hover:bg-green-500 text-white"
                    : "bg-orange-600 hover:bg-orange-500 text-white"
                }`}
              >
                {completeLoading ? "Saving…" : allDone ? "Confirm Shipped" : "Submit as Incomplete"}
              </button>
              <button
                onClick={() => setShowCompleteModal(false)}
                className="w-full py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-xl transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </main>
    );
  }

  // ─── History detail ───────────────────────────────────────────────────────────
  if (tab === "history" && selectedHistory) {
    const { shipped, expected } = getTotals(selectedHistory);

    return (
      <main className="min-h-screen flex flex-col bg-slate-950">
        {renderTopBar(
          selectedHistory.orderName,
          () => { setSelectedHistory(null); setHistoryScans([]); setExpandedHistoryItems(new Set()); }
        )}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 pb-6">
          {/* Order summary */}
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-4 space-y-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <span className="font-mono text-sm text-slate-100">{selectedHistory.trackingNumber}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${
                selectedHistory.isManualComplete
                  ? "bg-orange-900/40 border-orange-700 text-orange-300"
                  : "bg-green-900/40 border-green-700 text-green-300"
              }`}>
                {selectedHistory.isManualComplete ? "Incomplete" : "Complete"}
              </span>
            </div>
            {selectedHistory.shippedAt && (
              <p className="text-xs text-slate-500">
                Shipped {formatDate(selectedHistory.shippedAt)} by{" "}
                <span className="text-slate-300">{selectedHistory.completedBy}</span>
              </p>
            )}
            {selectedHistory.isManualComplete && selectedHistory.manualReason && (
              <p className="text-xs text-orange-300 bg-orange-900/20 border border-orange-800 rounded-lg px-3 py-2">
                Reason: {selectedHistory.manualReason}
              </p>
            )}
            <p className="text-xs text-slate-400">
              {shipped}/{expected} items scanned
            </p>
          </div>

          {/* Notes */}
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-4 space-y-2">
            <div className="flex items-center gap-2">
              <StickyNote className="w-4 h-4 text-slate-400 shrink-0" />
              <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Notes</span>
            </div>
            <textarea
              key={selectedHistory.fulfillmentId}
              defaultValue={selectedHistory.notes ?? ""}
              onBlur={(e) => {
                const value = e.target.value.trim();
                if (value !== (selectedHistory.notes ?? "")) {
                  saveFulfillmentNotes(selectedHistory.fulfillmentId, value, "history");
                }
              }}
              placeholder="e.g. added extra items, price issue, item damaged…"
              rows={2}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 resize-none focus:outline-none focus:ring-2 focus:ring-green-600"
            />
          </div>

          {/* Line items with scan events */}
          <div className="space-y-2">
            <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">Items & Scans</p>
            {selectedHistory.lineItems.map((li) => {
              const liScans = historyScans.filter(
                (s) => s.fulfillmentLineItemId === li.fulfillmentLineItemId
              );
              const done = li.quantityShipped >= li.quantityExpected;
              const isExpanded = expandedHistoryItems.has(li.fulfillmentLineItemId ?? "");
              return (
                <div
                  key={li.fulfillmentLineItemId}
                  className={`bg-slate-900 border rounded-xl overflow-hidden ${
                    done ? "border-green-800/50" : "border-slate-700"
                  }`}
                >
                  <button
                    type="button"
                    className="w-full p-3 flex items-center gap-3 text-left"
                    disabled={liScans.length === 0}
                    onClick={() => {
                      const key = li.fulfillmentLineItemId ?? "";
                      setExpandedHistoryItems((prev) => {
                        const next = new Set(prev);
                        if (next.has(key)) next.delete(key);
                        else next.add(key);
                        return next;
                      });
                    }}
                  >
                    {li.imageUrl ? (
                      <img
                        src={li.imageUrl}
                        alt={li.productTitle}
                        className="w-10 h-10 rounded-lg object-cover bg-slate-800 shrink-0"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-lg bg-slate-800 flex items-center justify-center shrink-0">
                        <Package className="w-5 h-5 text-slate-500" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-100 truncate">{li.productTitle}</p>
                      {li.variantTitle && <p className="text-xs text-slate-400">{li.variantTitle}</p>}
                    </div>
                    <span className={`text-xs font-mono px-2 py-0.5 rounded-full border shrink-0 ${
                      done
                        ? "bg-green-900/40 border-green-700 text-green-300"
                        : "bg-slate-800 border-slate-600 text-slate-300"
                    }`}>
                      {li.quantityShipped}/{li.quantityExpected}
                    </span>
                    {liScans.length > 0 && (
                      <ChevronDown
                        className={`w-4 h-4 text-slate-500 shrink-0 transition-transform ${
                          isExpanded ? "rotate-180" : ""
                        }`}
                      />
                    )}
                  </button>
                  {isExpanded && liScans.length > 0 && (
                    <div className="border-t border-slate-800 bg-slate-950/50 px-3 py-2 space-y-1">
                      {liScans.map((scan, i) => (
                        <div key={i} className="flex flex-col gap-0.5">
                          <div className="flex items-center gap-2 text-xs text-slate-500 flex-wrap">
                            <Clock className="w-3 h-3 shrink-0" />
                            <span>{formatDate(scan.scannedAt)}</span>
                            <span className="text-slate-600">·</span>
                            <span>{scan.scannedBy}</span>
                            {scan.isVariableWeight && scan.weightGrams != null && (
                              <>
                                <span className="text-slate-600">·</span>
                                <span className="text-purple-400">{formatWeightGrams(scan.weightGrams)}</span>
                              </>
                            )}
                            {scan.isRemoval && (
                              <span className="text-red-400">(removed)</span>
                            )}
                            {scan.isExtra && (
                              <span className="text-amber-400">
                                (extra{scan.extraReason ? `: ${scan.extraReason}` : ""})
                              </span>
                            )}
                          </div>
                          {scan.isVariableWeight && (scan.plu || scan.packagedAt) && (
                            <div className="flex items-center gap-2 text-[11px] text-slate-600 pl-5">
                              {scan.plu && <span>PLU {scan.plu}</span>}
                              {scan.plu && scan.packagedAt && <span>·</span>}
                              {scan.packagedAt && <span>Packaged {scan.packagedAt}</span>}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {historyScansLoading && (
            <div className="flex justify-center py-4">
              <div className="flex gap-2">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="w-2 h-2 rounded-full bg-green-400 animate-bounce"
                    style={{ animationDelay: `${i * 150}ms` }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </main>
    );
  }

  // ─── Main list view ───────────────────────────────────────────────────────────
  const filteredFulfillments = fulfillments.filter((f) => {
    if (!filterText) return true;
    const q = filterText.toLowerCase();
    return (
      f.orderName.toLowerCase().includes(q) ||
      f.trackingNumber.toLowerCase().includes(q) ||
      (f.customerName ?? "").toLowerCase().includes(q) ||
      f.lineItems.some(
        (li) =>
          li.productTitle.toLowerCase().includes(q) ||
          (li.sku ?? "").toLowerCase().includes(q)
      )
    );
  });

  const getOrderNumber = (orderName: string) => parseInt(orderName.replace(/\D/g, ""), 10) || 0;

  filteredFulfillments.sort((a, b) => {
    const diff = getOrderNumber(a.orderName) - getOrderNumber(b.orderName);
    return orderSort === "asc" ? diff : -diff;
  });

  return (
    <main className="min-h-screen flex flex-col bg-slate-950">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-slate-900 border-b border-slate-800 shrink-0">
        <button
          onClick={() => router.push("/")}
          className="p-2 -ml-2 text-slate-400 hover:text-slate-200 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-1 bg-slate-800 rounded-lg p-0.5">
          <button
            onClick={() => setTab("active")}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              tab === "active" ? "bg-green-600 text-white" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Active
          </button>
          <button
            onClick={() => setTab("history")}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              tab === "history" ? "bg-green-600 text-white" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            History
          </button>
        </div>
        <div className="flex items-center gap-1">
          {tab === "active" && (
            <>
              <button
                onClick={() => {
                  setPendingSyncRange(syncRange);
                  setSyncFiltersOpen((o) => !o);
                }}
                className="relative p-2 bg-slate-800 border border-slate-700 rounded-xl text-slate-400 hover:text-slate-200 hover:border-slate-600 transition-colors"
              >
                <Filter className="w-4 h-4" />
                {(syncRange.from || syncRange.to) && (
                  <span className="absolute -top-1 -right-1 w-2 h-2 bg-green-500 rounded-full" />
                )}
              </button>
              <button
                onClick={() => handleSync(syncRange.from || syncRange.to ? syncRange : undefined)}
                disabled={syncLoading}
                title={syncRange.from || syncRange.to ? `Sync ${syncRange.from || syncRange.to}–${syncRange.to || syncRange.from}` : "Sync today"}
                className="p-2 bg-slate-800 border border-slate-700 rounded-xl text-slate-400 hover:text-slate-200 hover:border-slate-600 transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${syncLoading ? "animate-spin" : ""}`} />
              </button>
            </>
          )}
          {tab === "history" && (
            <button
              onClick={() => {
                setPendingFilters(historyFilters);
                setHistoryFiltersOpen((o) => !o);
              }}
              className="relative p-2 bg-slate-800 border border-slate-700 rounded-xl text-slate-400 hover:text-slate-200 transition-colors"
            >
              <Filter className="w-4 h-4" />
              {activeFilterCount > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-green-500 text-white text-[10px] rounded-full flex items-center justify-center font-bold">
                  {activeFilterCount}
                </span>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Staff name chip */}
      <div className="px-4 pt-2 shrink-0">
        <button
          onClick={() => {
            setNameInput(staffName);
            setShowNamePrompt(true);
          }}
          className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors"
        >
          <User className="w-3 h-3" />
          <span>{staffName}</span>
        </button>
      </div>

      {/* ── ACTIVE TAB ── */}
      {tab === "active" && (
        <>
          {/* Sync date range panel */}
          {syncFiltersOpen && (
            <div className="px-4 pt-3 pb-2 shrink-0 bg-slate-900 border-b border-slate-800 space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-xs text-slate-400">Fulfilled from</label>
                  <input
                    type="date"
                    value={pendingSyncRange.from}
                    onChange={(e) => setPendingSyncRange((p) => ({ ...p, from: e.target.value }))}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-green-600"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-slate-400">Fulfilled to</label>
                  <input
                    type="date"
                    value={pendingSyncRange.to}
                    onChange={(e) => setPendingSyncRange((p) => ({ ...p, to: e.target.value }))}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-green-600"
                  />
                </div>
              </div>
              <p className="text-xs text-slate-500">Leave both empty to sync today&apos;s fulfillments.</p>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setSyncRange(pendingSyncRange);
                    setSyncFiltersOpen(false);
                    handleSync(pendingSyncRange.from || pendingSyncRange.to ? pendingSyncRange : undefined);
                  }}
                  disabled={syncLoading}
                  className="flex-1 py-2 bg-green-600 hover:bg-green-500 text-white font-semibold rounded-lg text-sm transition-colors disabled:opacity-50"
                >
                  Sync
                </button>
                <button
                  onClick={() => {
                    const cleared = { from: "", to: "" };
                    setPendingSyncRange(cleared);
                    setSyncRange(cleared);
                    setSyncFiltersOpen(false);
                  }}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-lg text-sm transition-colors"
                >
                  Clear
                </button>
              </div>
            </div>
          )}

          {/* Search + stats */}
          <div className="px-4 pt-2 pb-2 space-y-2 shrink-0">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="text"
                placeholder="Search orders, tracking, products…"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && filteredFulfillments.length === 0) handleSearchShopify();
                }}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl pl-9 pr-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-green-600"
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
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>
                {filteredFulfillments.length} pending shipment{filteredFulfillments.length !== 1 ? "s" : ""}
              </span>
              <div className="flex items-center gap-2">
                {syncLoading && <span className="text-green-400">Syncing…</span>}
                <button
                  onClick={() => setOrderSort((s) => (s === "asc" ? "desc" : "asc"))}
                  className="inline-flex items-center gap-1 px-2 py-1 bg-slate-800 border border-slate-700 rounded-lg text-slate-400 hover:text-slate-200 transition-colors"
                  title={`Sort by order number (${orderSort === "asc" ? "ascending" : "descending"})`}
                >
                  {orderSort === "asc" ? (
                    <ArrowUp className="w-3 h-3" />
                  ) : (
                    <ArrowDown className="w-3 h-3" />
                  )}
                  Order #
                </button>
              </div>
            </div>
            {banner && activeStep === "list" && (
              <StatusBanner type={banner.type} message={banner.message} />
            )}
          </div>

          {/* Fulfillments list */}
          <div className="flex-1 overflow-y-auto px-4 pb-6 space-y-3">
            {loadingFulfillments ? (
              <div className="flex items-center justify-center py-16">
                <div className="flex gap-2">
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      className="w-2 h-2 rounded-full bg-green-400 animate-bounce"
                      style={{ animationDelay: `${i * 150}ms` }}
                    />
                  ))}
                </div>
              </div>
            ) : filteredFulfillments.length === 0 ? (
              <div className="text-center py-16 text-slate-500 text-sm space-y-3">
                <p>
                  {filterText
                    ? "No matching shipments"
                    : "No pending shipments — tap sync to refresh from Shopify"}
                </p>
                {filterText && (
                  <button
                    onClick={handleSearchShopify}
                    disabled={searchLoading}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-slate-300 text-sm font-medium transition-colors disabled:opacity-50"
                  >
                    <Search className="w-4 h-4" />
                    {searchLoading ? "Searching…" : `Search Shopify for "${filterText}"`}
                  </button>
                )}
              </div>
            ) : (
              filteredFulfillments.map((f) => {
                const { shipped, expected } = getTotals(f);
                const pct = expected > 0 ? Math.round((shipped / expected) * 100) : 0;
                return (
                  <button
                    key={f.fulfillmentId}
                    onClick={() => {
                      setBanner(null);
                      setSelectedFulfillment(f);
                      setActiveStep("detail");
                    }}
                    className="w-full text-left bg-slate-900 border border-slate-700 hover:border-slate-500 rounded-2xl p-4 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-slate-100 font-bold">{f.orderName}</span>
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full border font-medium ${
                              f.status === "partial"
                                ? "bg-yellow-900/40 border-yellow-700 text-yellow-300"
                                : "bg-slate-800 border-slate-700 text-slate-400"
                            }`}
                          >
                            {f.status}
                          </span>
                          {f.notes && <StickyNote className="w-3.5 h-3.5 text-amber-400 shrink-0" />}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="font-mono text-xs text-slate-400 truncate">{f.trackingNumber}</span>
                          {f.trackingCarrier && (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-slate-800 text-slate-500 shrink-0">
                              {f.trackingCarrier}
                            </span>
                          )}
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-500 shrink-0 mt-1" />
                    </div>

                    {f.customerName && (
                      <p className="text-xs text-slate-500 mt-1.5">
                        {f.customerName}
                        {f.shippingAddress?.city && ` · ${f.shippingAddress.city}, ${f.shippingAddress.provinceCode}`}
                      </p>
                    )}

                    {/* Progress bar */}
                    <div className="mt-3">
                      <div className="flex justify-between text-xs text-slate-500 mb-1">
                        <span>{shipped}/{expected} items</span>
                        <span>{pct}%</span>
                      </div>
                      <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-green-500 rounded-full transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>

                    {f.orderTags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {f.orderTags.slice(0, 3).map((tag) => (
                          <span
                            key={tag}
                            className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-500 border border-slate-700"
                          >
                            {tag}
                          </span>
                        ))}
                        {f.orderTags.length > 3 && (
                          <span className="text-xs text-slate-600">+{f.orderTags.length - 3}</span>
                        )}
                      </div>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </>
      )}

      {/* ── HISTORY TAB ── */}
      {tab === "history" && (
        <>
          {/* Filter panel */}
          {historyFiltersOpen && (
            <div className="px-4 pt-3 pb-2 shrink-0 bg-slate-900 border-b border-slate-800 space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-xs text-slate-400">From</label>
                  <input
                    type="date"
                    value={pendingFilters.from}
                    onChange={(e) => setPendingFilters((p) => ({ ...p, from: e.target.value }))}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-green-600"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-slate-400">To</label>
                  <input
                    type="date"
                    value={pendingFilters.to}
                    onChange={(e) => setPendingFilters((p) => ({ ...p, to: e.target.value }))}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-green-600"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-400">Staff Name</label>
                <input
                  type="text"
                  placeholder="Filter by staff name"
                  value={pendingFilters.scannedBy}
                  onChange={(e) => setPendingFilters((p) => ({ ...p, scannedBy: e.target.value }))}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-green-600"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-400">Type</label>
                <select
                  value={pendingFilters.type}
                  onChange={(e) => setPendingFilters((p) => ({ ...p, type: e.target.value as HistoryType }))}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-green-600"
                >
                  <option value="all">All shipments</option>
                  <option value="complete">Complete only</option>
                  <option value="incomplete">Incomplete only</option>
                </select>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setHistoryFilters(pendingFilters);
                    fetchHistory(pendingFilters);
                    setHistoryFiltersOpen(false);
                  }}
                  className="flex-1 py-2 bg-green-600 hover:bg-green-500 text-white font-semibold rounded-lg text-sm transition-colors"
                >
                  Apply Filters
                </button>
                <button
                  onClick={() => {
                    const cleared: HistoryFilters = { from: "", to: "", scannedBy: "", type: "all" };
                    setPendingFilters(cleared);
                    setHistoryFilters(cleared);
                    fetchHistory(cleared);
                    setHistoryFiltersOpen(false);
                  }}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-lg text-sm transition-colors"
                >
                  Clear
                </button>
              </div>
            </div>
          )}

          <div className="px-4 pt-3 pb-1 shrink-0">
            <p className="text-xs text-slate-500">
              {historyFulfillments.length} shipped order{historyFulfillments.length !== 1 ? "s" : ""}
            </p>
          </div>

          <div className="flex-1 overflow-y-auto px-4 pb-6 space-y-3">
            {historyLoading ? (
              <div className="flex items-center justify-center py-16">
                <div className="flex gap-2">
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      className="w-2 h-2 rounded-full bg-green-400 animate-bounce"
                      style={{ animationDelay: `${i * 150}ms` }}
                    />
                  ))}
                </div>
              </div>
            ) : historyFulfillments.length === 0 ? (
              <div className="text-center py-16 text-slate-500 text-sm">
                No shipped orders found
              </div>
            ) : (
              historyFulfillments.map((f) => {
                const { shipped, expected } = getTotals(f);
                return (
                  <button
                    key={f.fulfillmentId}
                    onClick={() => {
                      setSelectedHistory(f);
                      fetchHistoryScans(f.fulfillmentId);
                    }}
                    className="w-full text-left bg-slate-900 border border-slate-700 hover:border-slate-500 rounded-2xl p-4 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-slate-100 font-bold">{f.orderName}</span>
                          {f.isManualComplete ? (
                            <span className="text-xs px-2 py-0.5 rounded-full border bg-orange-900/40 border-orange-700 text-orange-300 font-medium">
                              Incomplete
                            </span>
                          ) : (
                            <span className="text-xs px-2 py-0.5 rounded-full border bg-green-900/40 border-green-700 text-green-300 font-medium">
                              Complete
                            </span>
                          )}
                          {f.notes && <StickyNote className="w-3.5 h-3.5 text-amber-400 shrink-0" />}
                        </div>
                        <span className="font-mono text-xs text-slate-400">{f.trackingNumber}</span>
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-500 shrink-0 mt-1" />
                    </div>

                    {f.shippedAt && f.completedBy && (
                      <div className="flex items-center gap-1.5 mt-2 text-xs text-slate-500">
                        <User className="w-3 h-3" />
                        <span>{f.completedBy}</span>
                        <span className="text-slate-700">·</span>
                        <Clock className="w-3 h-3" />
                        <span>{formatDateShort(f.shippedAt)}</span>
                      </div>
                    )}

                    <p className="text-xs text-slate-500 mt-1">
                      {shipped}/{expected} items scanned
                    </p>

                    {f.orderTags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {f.orderTags.slice(0, 3).map((tag) => (
                          <span
                            key={tag}
                            className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-500 border border-slate-700"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </>
      )}
    </main>
  );
}
