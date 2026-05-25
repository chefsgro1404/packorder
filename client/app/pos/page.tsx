"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { ProductCard } from "@/components/ProductCard";
import { CartDrawer } from "@/components/CartDrawer";
import { StatusBanner } from "@/components/StatusBanner";
import { useCart } from "@/hooks/useCart";
import { useScanner } from "@/hooks/useScanner";
import { ProductVariant } from "@/lib/types";
import { ShoppingCart, ArrowLeft } from "lucide-react";

type ScanState = "scanning" | "loading" | "found" | "error";

export default function POSPage() {
  const router = useRouter();
  const { items, draftOrderId, setDraftOrderId, total, addItem, removeItem, clearCart } = useCart();
  const { handleScan, playBeep } = useScanner();

  const [scanState, setScanState] = useState<ScanState>("scanning");
  const [scannedProduct, setScannedProduct] = useState<ProductVariant | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [cartOpen, setCartOpen] = useState(false);
  const [addingToCart, setAddingToCart] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutSuccess, setCheckoutSuccess] = useState<string | null>(null);

  const onScan = useCallback(async (value: string) => {
    setScanState("loading");
    setScannedProduct(null);

    try {
      const res = await fetch(`/api/product?barcode=${encodeURIComponent(value)}`);
      const data = await res.json();

      if (data.found) {
        playBeep();
        setScannedProduct(data.variant);
        setScanState("found");
      } else {
        navigator.vibrate?.([50, 30, 50]);
        setErrorMessage(`SKU not found in Shopify: ${value}`);
        setScanState("error");
        setTimeout(() => setScanState("scanning"), 2500);
      }
    } catch {
      setErrorMessage("Network error");
      setScanState("error");
      setTimeout(() => setScanState("scanning"), 2500);
    }
  }, [playBeep]);

  const handleAddToCart = async () => {
    if (!scannedProduct) return;
    setAddingToCart(true);

    try {
      if (!draftOrderId) {
        const res = await fetch("/api/draft-order", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "create",
            variantId: scannedProduct.id,
            quantity: 1,
          }),
        });
        const data = await res.json();
        if (data.ok) {
          setDraftOrderId((data.draftOrder as { id: string }).id);
        }
      } else {
        const newItems = [
          ...items.map((i) => ({ variantId: i.variantId, quantity: i.quantity })),
          { variantId: scannedProduct.id, quantity: 1 },
        ];
        await fetch("/api/draft-order", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "add-item",
            draftOrderId,
            lineItems: newItems,
          }),
        });
      }

      addItem({
        variantId: scannedProduct.id,
        productTitle: scannedProduct.product.title,
        variantTitle: scannedProduct.title,
        price: scannedProduct.price,
        quantity: 1,
        imageUrl: scannedProduct.product.featuredImage?.url,
      });

      setScanState("scanning");
      setScannedProduct(null);
    } catch {
      setErrorMessage("Failed to add to cart");
      setScanState("error");
      setTimeout(() => setScanState("scanning"), 2500);
    } finally {
      setAddingToCart(false);
    }
  };

  const handleCheckout = async () => {
    if (!draftOrderId) return;
    setCheckoutLoading(true);

    try {
      const res = await fetch("/api/draft-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "complete", draftOrderId }),
      });
      const data = await res.json();

      if (data.ok) {
        const orderName = (data.result as { order?: { name: string } })?.order?.name || "Order";
        setCheckoutSuccess(`${orderName} created successfully!`);
        clearCart();
        setCartOpen(false);
        setTimeout(() => setCheckoutSuccess(null), 4000);
      } else {
        setErrorMessage(data.error || "Checkout failed");
        setScanState("error");
        setTimeout(() => setScanState("scanning"), 2500);
      }
    } catch {
      setErrorMessage("Network error during checkout");
    } finally {
      setCheckoutLoading(false);
    }
  };

  const isOnline = typeof window !== "undefined" ? navigator.onLine : true;

  return (
    <main className="min-h-screen flex flex-col bg-slate-950">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-slate-900 border-b border-slate-800">
        <button
          onClick={() => router.push("/")}
          className="p-2 -ml-2 text-slate-400 hover:text-slate-200 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="font-bold text-slate-100">POS Mode</h1>
        <button
          onClick={() => setCartOpen(true)}
          className="relative p-2 -mr-2 text-slate-400 hover:text-slate-200 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
        >
          <ShoppingCart className="w-5 h-5" />
          {items.length > 0 && (
            <span className="absolute top-1 right-1 w-4 h-4 bg-blue-600 rounded-full text-xs flex items-center justify-center text-white font-bold">
              {items.length}
            </span>
          )}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col gap-4 p-4 overflow-y-auto pb-safe">
        {!isOnline && (
          <StatusBanner type="warning" message="You are offline. Check your connection." />
        )}

        {checkoutSuccess && (
          <StatusBanner type="success" message={checkoutSuccess} autoDismiss={4000} onDismiss={() => setCheckoutSuccess(null)} />
        )}

        <BarcodeScanner
          onScan={(v) => handleScan(v, onScan)}
          active={scanState === "scanning"}
        />

        {scanState === "loading" && (
          <div className="flex items-center justify-center py-8">
            <div className="flex gap-2">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="w-2 h-2 rounded-full bg-blue-400 animate-bounce"
                  style={{ animationDelay: `${i * 150}ms` }}
                />
              ))}
            </div>
          </div>
        )}

        {scanState === "found" && scannedProduct && (
          <ProductCard
            variant={scannedProduct}
            onAddToCart={handleAddToCart}
            loading={addingToCart}
          />
        )}

        {scanState === "error" && (
          <StatusBanner type="error" message={errorMessage} />
        )}
      </div>

      <CartDrawer
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        items={items}
        total={total}
        onRemoveItem={removeItem}
        onCheckout={handleCheckout}
        checkoutLoading={checkoutLoading}
      />
    </main>
  );
}
