"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import dynamic from "next/dynamic";

interface BarcodeScannerProps {
  onScan: (value: string, frame: string) => void;
  onError?: (error: string) => void;
  active: boolean;
}

function BarcodeScannerInner({ onScan, onError, active }: BarcodeScannerProps) {
  const containerRef   = useRef<HTMLDivElement>(null);
  const nativeVideoRef = useRef<HTMLVideoElement | null>(null);
  const nativeStreamRef = useRef<MediaStream | null>(null);
  const scanningRef    = useRef(false);
  const scannerRef     = useRef<{ stop: () => void } | null>(null);
  const activeRef      = useRef(active);

  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manualInput, setManualInput] = useState("");
  const [flash, setFlash] = useState(false);

  const onScanRef  = useRef(onScan);
  const onErrorRef = useRef(onError);
  useEffect(() => { onScanRef.current  = onScan;  }, [onScan]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);
  useEffect(() => { activeRef.current  = active;  }, [active]);

  const captureFrame = useCallback((): string => {
    const video = nativeVideoRef.current
      ?? (containerRef.current?.querySelector("video") as HTMLVideoElement | null);
    if (!video || !video.videoWidth) return "";
    const canvas = document.createElement("canvas");
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";
    ctx.drawImage(video, 0, 0);
    return canvas.toDataURL("image/jpeg", 0.8);
  }, []);

  // ── Native BarcodeDetector (Safari 17.4+, Chrome desktop/Android) ─────────
  const stopNative = useCallback(() => {
    scanningRef.current = false;
    nativeStreamRef.current?.getTracks().forEach(t => t.stop());
    nativeStreamRef.current = null;
    nativeVideoRef.current?.remove();
    nativeVideoRef.current = null;
  }, []);

  const startNative = useCallback(async () => {
    if (!containerRef.current) return;

    // 640×480 is enough resolution for QR codes and decodes ~4× faster than 1280×720
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", width: { ideal: 640 }, height: { ideal: 480 } },
    });
    nativeStreamRef.current = stream;

    const video = document.createElement("video");
    video.srcObject = stream;
    video.setAttribute("playsinline", "true");
    video.style.cssText = "width:100%;height:100%;object-fit:cover;";
    containerRef.current.appendChild(video);
    nativeVideoRef.current = video;
    await video.play();

    type DetectorInstance = { detect(src: HTMLVideoElement): Promise<{ rawValue: string }[]> };
    const BarcodeDetectorCtor = (window as unknown as {
      BarcodeDetector: new (opts: { formats: string[] }) => DetectorInstance;
    }).BarcodeDetector;
    const detector = new BarcodeDetectorCtor({
      formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "qr_code", "data_matrix"],
    });

    // No artificial delay — let BarcodeDetector run as fast as the device allows
    scanningRef.current = true;
    const loop = async () => {
      while (scanningRef.current) {
        try {
          if (nativeVideoRef.current && nativeVideoRef.current.readyState >= 2) {
            const results = await detector.detect(nativeVideoRef.current);
            if (results.length > 0 && scanningRef.current) {
              setFlash(true);
              setTimeout(() => setFlash(false), 200);
              onScanRef.current(results[0].rawValue, captureFrame());
            }
          }
        } catch { /* per-frame errors are normal */ }
        // Yield to keep the UI responsive without adding a fixed sleep
        await new Promise<void>(r => requestAnimationFrame(() => r()));
      }
    };
    loop();
  }, [captureFrame]);

  // ── ZXing fallback with TRY_HARDER — better real-world 1D scanning ────────
  const stopZXing = useCallback(() => {
    scannerRef.current?.stop();
    scannerRef.current = null;
    nativeVideoRef.current?.remove();
    nativeVideoRef.current = null;
  }, []);

  const startZXing = useCallback(async () => {
    if (!containerRef.current) return;

    const { BrowserMultiFormatReader } = await import("@zxing/browser");
    const { DecodeHintType, BarcodeFormat } = await import("@zxing/library");

    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.UPC_A,
      BarcodeFormat.UPC_E,
      BarcodeFormat.CODE_128,
      BarcodeFormat.CODE_39,
      BarcodeFormat.QR_CODE,
      BarcodeFormat.DATA_MATRIX,
    ]);
    hints.set(DecodeHintType.TRY_HARDER, true);

    const codeReader = new BrowserMultiFormatReader(hints, {
      delayBetweenScanAttempts: 0,  // scan every frame — resolution drop makes this safe
    });

    const video = document.createElement("video");
    video.setAttribute("playsinline", "true");
    video.style.cssText = "width:100%;height:100%;object-fit:cover;";
    containerRef.current.appendChild(video);
    nativeVideoRef.current = video;

    const controls = await codeReader.decodeFromConstraints(
      { video: { facingMode: "environment", width: { ideal: 640 }, height: { ideal: 480 } } },
      video,
      (result) => {
        if (!result) return;
        setFlash(true);
        setTimeout(() => setFlash(false), 300);
        onScanRef.current(result.getText(), captureFrame());
      }
    );

    scannerRef.current = controls;
  }, [captureFrame]);

  // ── Unified start / stop ──────────────────────────────────────────────────
  const stopScanner = useCallback(() => {
    stopNative();
    stopZXing();
  }, [stopNative, stopZXing]);

  const startScanner = useCallback(async () => {
    try {
      if ("BarcodeDetector" in window) {
        await startNative();
      } else {
        await startZXing();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setCameraError(message);
      onErrorRef.current?.(message);
    }
  }, [startNative, startZXing]);

  useEffect(() => {
    if (active && !cameraError) {
      startScanner();
    } else if (!active) {
      stopScanner();
    }
    return () => { stopScanner(); };
  }, [active, cameraError, startScanner, stopScanner]);

  // Wake lock
  useEffect(() => {
    if (!active) return;
    let wakeLock: { release: () => Promise<void> } | null = null;
    const acquire = async () => {
      try {
        wakeLock = await (navigator as unknown as {
          wakeLock: { request: (t: string) => Promise<{ release: () => Promise<void> }> };
        }).wakeLock.request("screen");
      } catch { /* not supported */ }
    };
    acquire();
    return () => { wakeLock?.release(); };
  }, [active]);

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (manualInput.trim()) {
      onScanRef.current(manualInput.trim(), "");
      setManualInput("");
    }
  };

  return (
    <div className="relative w-full select-none">
      {cameraError ? (
        <div className="flex flex-col items-center gap-4 p-6 bg-slate-900 rounded-2xl border border-slate-700">
          <div className="text-slate-400 text-sm text-center space-y-1">
            <p>Camera unavailable. Enter barcode manually.</p>
            <p className="text-xs text-red-400 break-all">{cameraError}</p>
          </div>
          <form onSubmit={handleManualSubmit} className="flex gap-2 w-full">
            <input
              type="text"
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              placeholder="Scan or type barcode..."
              className="flex-1 px-4 py-3 bg-slate-800 border border-slate-600 rounded-xl text-slate-100 placeholder-slate-500 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
            <button
              type="submit"
              className="px-4 py-3 bg-blue-600 hover:bg-blue-500 rounded-xl font-medium transition-colors min-w-[48px]"
            >
              Go
            </button>
          </form>
        </div>
      ) : (
        <div className="relative rounded-2xl overflow-hidden">
          <div
            id="barcode-scanner-container"
            ref={containerRef}
            className="scanner-container w-full h-72 bg-slate-900"
          />
          <div className="absolute inset-0 pointer-events-none">
            {/* Full-area flash on scan */}
            <div
              className={`absolute inset-0 transition-colors duration-100 rounded-2xl ${
                flash ? "bg-green-500/30" : "bg-transparent"
              }`}
            />
            {/* Thin border around the whole area — entire view is the scan zone */}
            <div className="absolute inset-2 border-2 border-blue-400/50 rounded-xl" />
            {/* Corner accents */}
            <div className="absolute top-2 left-2 w-6 h-6 border-t-3 border-l-3 border-blue-400 rounded-tl-lg" />
            <div className="absolute top-2 right-2 w-6 h-6 border-t-3 border-r-3 border-blue-400 rounded-tr-lg" />
            <div className="absolute bottom-2 left-2 w-6 h-6 border-b-3 border-l-3 border-blue-400 rounded-bl-lg" />
            <div className="absolute bottom-2 right-2 w-6 h-6 border-b-3 border-r-3 border-blue-400 rounded-br-lg" />
          </div>
          {/* Status bar at the bottom */}
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-slate-900/90 to-transparent px-3 py-2 flex items-center justify-between">
            <span className="text-xs text-slate-300">Point camera at any code — no need to center it</span>
            {active && (
              <div className="flex gap-1">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="w-1 h-1 rounded-full bg-blue-400 animate-bounce"
                    style={{ animationDelay: `${i * 150}ms` }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export const BarcodeScanner = dynamic(
  () => Promise.resolve(BarcodeScannerInner),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-64 bg-slate-900 rounded-2xl flex items-center justify-center">
        <div className="text-slate-500 text-sm">Loading camera…</div>
      </div>
    ),
  }
);
