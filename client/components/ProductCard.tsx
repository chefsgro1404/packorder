"use client";

import { ProductVariant } from "@/lib/types";
import Image from "next/image";

interface ProductCardProps {
  variant: ProductVariant;
  onAddToCart: () => void;
  loading?: boolean;
}

export function ProductCard({ variant, onAddToCart, loading }: ProductCardProps) {
  return (
    <div className="bg-slate-900 border border-slate-700 rounded-2xl p-4 animate-in slide-in-from-bottom-4 duration-300">
      <div className="flex gap-4 items-start">
        {variant.product.featuredImage ? (
          <div className="relative w-16 h-16 rounded-xl overflow-hidden bg-slate-800 shrink-0">
            <Image
              src={variant.product.featuredImage.url}
              alt={variant.product.featuredImage.altText || variant.product.title}
              fill
              className="object-cover"
              sizes="64px"
            />
          </div>
        ) : (
          <div className="w-16 h-16 rounded-xl bg-slate-800 flex items-center justify-center shrink-0">
            <span className="text-2xl">📦</span>
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-xs text-slate-400 font-mono truncate">{variant.sku || variant.barcode}</p>
          <h3 className="font-semibold text-slate-100 leading-tight mt-0.5">
            {variant.product.title}
          </h3>
          {variant.title !== "Default Title" && (
            <p className="text-sm text-slate-400 mt-0.5">{variant.title}</p>
          )}
          <div className="flex items-center gap-3 mt-2">
            <span className="text-lg font-bold text-blue-400">${variant.price}</span>
            {variant.inventoryQuantity <= 0 && (
              <span className="text-xs px-2 py-0.5 bg-orange-900/50 text-orange-400 rounded-full border border-orange-800">
                Out of stock
              </span>
            )}
          </div>
        </div>
      </div>
      <button
        onClick={onAddToCart}
        disabled={loading}
        className="mt-4 w-full py-3 bg-blue-600 hover:bg-blue-500 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed rounded-xl font-semibold text-base transition-all duration-150 min-h-[48px]"
      >
        {loading ? "Adding..." : "Add to Cart"}
      </button>
    </div>
  );
}
