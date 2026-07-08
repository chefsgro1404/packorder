"use client";

import { useCallback, useRef } from "react";

export function useScanner() {
  const lastScanRef = useRef<string | null>(null);
  const lastScanTimeRef = useRef<number>(0);
  const DEBOUNCE_MS = 800;

  const handleScan = useCallback(
    (value: string, onScan: (v: string) => void) => {
      const now = Date.now();
      if (
        value === lastScanRef.current &&
        now - lastScanTimeRef.current < DEBOUNCE_MS
      ) {
        return;
      }
      lastScanRef.current = value;
      lastScanTimeRef.current = now;
      navigator.vibrate?.(50);
      onScan(value);
    },
    []
  );

  const playBeep = useCallback(() => {
    try {
      const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.frequency.value = 880;
      oscillator.type = "sine";
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
      oscillator.start(ctx.currentTime);
      oscillator.stop(ctx.currentTime + 0.08);
    } catch {
      // Audio not supported
    }
  }, []);

  return { handleScan, playBeep };
}
