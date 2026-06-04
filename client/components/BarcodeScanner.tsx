"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import dynamic from "next/dynamic";

interface BarcodeScannerProps {
  onScan: (value: string, frame: string) => void;
  onError?: (error: string) => void;
  active: boolean;
}

function BarcodeScannerInner({ onScan, onError, active }: BarcodeScannerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scannerRef = useRef<unknown>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manualInput, setManualInput] = useState("");
  const [flash, setFlash] = useState(false);
  const onScanRef = useRef(onScan);
  const onErrorRef = useRef(onError);

  useEffect(() => { onScanRef.current = onScan; }, [onScan]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);

  const captureFrame = useCallback((): string => {
    const video = containerRef.current?.querySelector("video") as HTMLVideoElement | null;
    if (!video || !video.videoWidth) return "";
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";
    ctx.drawImage(video, 0, 0);
    return canvas.toDataURL("image/jpeg", 0.8);
  }, []);

  const startScanner = useCallback(async () => {
    if (!containerRef.current) return;
    try {
      const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import("html5-qrcode");
      const scanner = new Html5Qrcode("barcode-scanner-container", {
        formatsToSupport: [
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.EAN_8,
          Html5QrcodeSupportedFormats.UPC_A,
          Html5QrcodeSupportedFormats.UPC_E,
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.CODE_39,

          Html5QrcodeSupportedFormats.QR_CODE,
          Html5QrcodeSupportedFormats.DATA_MATRIX,
        ],
        verbose: false,
      });
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: "environment" },
        {
          fps: 15,
          qrbox: (viewfinderWidth: number, viewfinderHeight: number) => ({
            width: Math.round(viewfinderWidth * 0.85),
            height: Math.round(viewfinderHeight * 0.45),
          }),
        },
        (decodedText: string) => {
          setFlash(true);
          setTimeout(() => setFlash(false), 300);
          onScanRef.current(decodedText, captureFrame());
        },
        () => {}
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setCameraError(message);
      onErrorRef.current?.(message);
    }
  }, [captureFrame]);

  const stopScanner = useCallback(async () => {
    if (!scannerRef.current) return;
    const scanner = scannerRef.current as { isScanning: boolean; stop: () => Promise<void>; clear: () => void };
    try {
      if (scanner.isScanning) {
        await scanner.stop();
        scanner.clear();
      }
    } catch {
      // ignore cleanup errors
    }
    scannerRef.current = null;
  }, []);

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
        wakeLock = await (navigator as unknown as { wakeLock: { request: (type: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock.request("screen");
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
          <div className="text-slate-400 text-sm text-center">
            Camera unavailable. Enter barcode manually.
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
            className="scanner-container w-full h-64 bg-slate-900"
          />
          {/* Scanning overlay corners */}
          <div className="absolute inset-0 pointer-events-none">
            <div
              className={`absolute inset-0 transition-colors duration-150 ${
                flash ? "bg-green-500/20" : "bg-transparent"
              }`}
            />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="relative w-72 h-28">
                <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-blue-400 rounded-tl-lg" />
                <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-blue-400 rounded-tr-lg" />
                <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-blue-400 rounded-bl-lg" />
                <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-blue-400 rounded-br-lg" />
                <div className="absolute inset-0 border border-blue-400/20 rounded-lg" />
                <div className="absolute inset-x-6 top-1/2 -translate-y-px h-px bg-blue-400/40" />
              </div>
            </div>
          </div>
          {active && (
            <div className="absolute bottom-3 left-0 right-0 flex justify-center">
              <div className="flex gap-1">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce"
                    style={{ animationDelay: `${i * 150}ms` }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Must be dynamically imported — html5-qrcode uses window on init
export const BarcodeScanner = dynamic(
  () => Promise.resolve(BarcodeScannerInner),
  { ssr: false, loading: () => (
    <div className="w-full h-64 bg-slate-900 rounded-2xl flex items-center justify-center">
      <div className="text-slate-500 text-sm">Loading camera...</div>
    </div>
  )}
);
