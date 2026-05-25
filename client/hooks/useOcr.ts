"use client";

import { useCallback, useRef } from "react";

export interface LabelData {
  weightGrams: number | null;
  pricePerLb: number | null;
  totalPrice: number | null;
  rawText: string;
}

type TesseractWorker = {
  recognize: (img: string) => Promise<{ data: { text: string } }>;
};

export function useOcr() {
  const workerRef = useRef<TesseractWorker | null>(null);
  const loadingRef = useRef(false);

  const getWorker = useCallback(async (): Promise<TesseractWorker> => {
    if (workerRef.current) return workerRef.current;
    if (loadingRef.current) {
      await new Promise<void>((resolve) => {
        const poll = () => (workerRef.current ? resolve() : setTimeout(poll, 100));
        poll();
      });
      return workerRef.current!;
    }
    loadingRef.current = true;
    const { createWorker } = await import("tesseract.js");
    const worker = (await createWorker("eng")) as unknown as TesseractWorker;
    workerRef.current = worker;
    loadingRef.current = false;
    return worker;
  }, []);

  const extractLabelData = useCallback(
    async (imageDataUrl: string): Promise<LabelData> => {
      const worker = await getWorker();
      const { data } = await worker.recognize(imageDataUrl);
      return parseLabel(data.text);
    },
    [getWorker]
  );

  return { extractLabelData };
}

// ─── Label text parser ────────────────────────────────────────────────────────
// Pattern documentation: see /LABEL_FORMAT.md

function parseLabel(text: string): LabelData {
  // Price per lb — format: $5.79/lb
  // LABEL_FORMAT: update PRICE_PER_LB_PATTERN in LABEL_FORMAT.md if format changes
  const pricePerLbMatch = text.match(/\$\s*(\d+\.?\d*)\s*\/\s*lb/i);
  const pricePerLb = pricePerLbMatch ? parseFloat(pricePerLbMatch[1]) : null;

  // Weight — kg preferred, then raw grams, then lb (guarded against /lb match)
  // LABEL_FORMAT: update WEIGHT_PATTERNS in LABEL_FORMAT.md if format changes
  let weightGrams: number | null = null;
  const kgMatch = text.match(/\b(\d+\.?\d*)\s*kg\b/i);
  const gMatch = text.match(/\b(\d{3,5})\s*g\b/i);
  const lbMatch = text.match(/\b(\d+\.?\d*)\s*lb\b/i);

  if (kgMatch) {
    weightGrams = parseFloat(kgMatch[1]) * 1000;
  } else if (gMatch) {
    weightGrams = parseFloat(gMatch[1]);
  } else if (lbMatch) {
    const before = text.slice(0, lbMatch.index ?? 0);
    if (!before.trimEnd().endsWith("/")) {
      weightGrams = parseFloat(lbMatch[1]) * 453.592;
    }
  }

  // Total price — first $X.XX not followed by /lb
  // LABEL_FORMAT: update TOTAL_PRICE_PATTERN in LABEL_FORMAT.md if format changes
  let totalPrice: number | null = null;
  for (const m of text.matchAll(/\$\s*(\d+\.\d{2})/g)) {
    const after = text.slice(
      (m.index ?? 0) + m[0].length,
      (m.index ?? 0) + m[0].length + 10
    );
    if (!/^\s*\/\s*lb/i.test(after)) {
      totalPrice = parseFloat(m[1]);
      break;
    }
  }

  return { weightGrams, pricePerLb, totalPrice, rawText: text };
}
