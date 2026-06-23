'use client';

import { useEffect, useState } from 'react';
import { parseScaleBuffer } from '@/lib/scaleParser';

export interface ParsedReading {
  itemName: string;
  itemNumber: string;
  itemWeight: string;
  qrPayload: string;
  rawBuffer: string;
  timestamp: Date;
}

export type ScaleState = 'disconnected' | 'connected' | 'receiving' | 'processing';

const SILENCE_MS = 2000;
const POLL_MS = 50;
const STALL_MS = 8000; // no chunks at all for this long while "receiving" — give up and log it, instead of hanging silently
const STORAGE_KEY = 'shipscale_scale_granted';

// Module-level singleton — the actual port/reader and connection state live here, not in
// any React component. Pages under /scale each call useScale(), but a Next.js route change
// can remount the component tree (e.g. transitioning into a dynamic [id] segment); if the
// connection lived in per-component state/refs, that remount would silently lose it and the
// next page would have to reopen a port that — from the browser's perspective — never closed.
// Living outside React, the connection survives any number of mounts/unmounts. The boot log
// below is a deliberate diagnostic: if this module were ever duplicated across route chunks
// (which would silently break the singleton), it would log more than once per page load.
console.log('[scale] useScale module instance booted at', new Date().toISOString());

interface ScaleSnapshot {
  state: ScaleState;
  error: string | null;
  chunkCount: number;
  portLabel: string | null;
  lastReading: ParsedReading | null;
  lastRawBuffer: string | null;
  listenerActive: boolean;
}

let snapshot: ScaleSnapshot = {
  state: 'disconnected',
  error: null,
  chunkCount: 0,
  portLabel: null,
  lastReading: null,
  lastRawBuffer: null,
  listenerActive: false,
};
let port: SerialPort | null = null;
let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
let active = false;
let onReadingCallback: ((r: ParsedReading) => void) | null = null;
const listeners = new Set<() => void>();

function setSnapshot(patch: Partial<ScaleSnapshot>) {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((l) => l());
}

async function startListening(p: SerialPort) {
  active = true;

  while (active) {
    let buffer = '';
    let lastReceive = Date.now();
    let chunks = 0;
    let streamDone = false;

    const r = p.readable!.getReader();
    reader = r;
    setSnapshot({ state: 'receiving' });
    const receivingSince = Date.now();

    // Wait for 2s silence to know the transmission is complete. If literally nothing
    // arrives for STALL_MS (e.g. the scale was triggered without sending anything, or a
    // cable/setting issue), give up and log it instead of sitting in "receiving" forever
    // with no visible feedback.
    const checker = setInterval(() => {
      if (Date.now() - lastReceive > SILENCE_MS && buffer.length > 0) {
        streamDone = true;
        clearInterval(checker);
        r.cancel().catch(() => {});
      } else if (buffer.length === 0 && Date.now() - receivingSince > STALL_MS) {
        console.warn('[scale] stalled — no data received within', STALL_MS, 'ms; resetting to connected');
        clearInterval(checker);
        r.cancel().catch(() => {});
      }
    }, POLL_MS);

    try {
      while (true) {
        const { value, done } = await r.read();
        if (done) break;
        buffer += new TextDecoder('ascii').decode(value);
        lastReceive = Date.now();
        chunks += 1;
        setSnapshot({ chunkCount: chunks });
      }
    } catch {
      // normal — reader was cancelled by silence detector
    } finally {
      clearInterval(checker);
      r.releaseLock();
      reader = null;
    }

    if (!active) break;

    if (buffer.length === 0) {
      console.warn('[scale] no chunks received this cycle — listener active:', onReadingCallback != null);
    }

    if (streamDone && buffer.length > 0) {
      setSnapshot({ state: 'processing', lastRawBuffer: buffer });
      const result = parseScaleBuffer(buffer);
      console.log(`[scale] received ${chunks} chunk(s), ${buffer.length} bytes:`, JSON.stringify(buffer));

      // itemName/itemNumber are allowed to be empty — a weight-only signal (no PLU
      // recall) is valid input for pages that already know the product, e.g.
      // /scale/products/[id]. Only the weight itself is required.
      if (result.success && result.itemWeight && result.qrPayload) {
        const parsedReading: ParsedReading = {
          itemName: result.itemName ?? '',
          itemNumber: result.itemNumber ?? '',
          itemWeight: result.itemWeight,
          qrPayload: result.qrPayload,
          rawBuffer: buffer,
          timestamp: new Date(),
        };
        console.log('[scale] parsed reading:', parsedReading.itemName || '(weight-only)', parsedReading.itemNumber || '(no item)', parsedReading.itemWeight,
          '— listener active:', onReadingCallback != null);
        setSnapshot({ lastReading: parsedReading, error: null });
        onReadingCallback?.(parsedReading);
      } else if (result.error === 'OVERLOAD') {
        console.warn('[scale] OVERLOAD reported by scale');
        setSnapshot({ error: 'Scale overload — remove excess weight and try again.' });
      } else if (result.error === 'NO_ITEM') {
        console.warn('[scale] no ITEM line found in buffer:', JSON.stringify(buffer));
        setSnapshot({ error: 'No item data received. Trigger the scale again.' });
      } else {
        console.error('[scale] failed to parse buffer:', JSON.stringify(buffer), 'error:', result.error);
        setSnapshot({ error: 'Could not parse scale data. Try again.' });
      }
    }

    if (active) {
      setSnapshot({ state: 'connected', chunkCount: 0 });
      await new Promise((res) => setTimeout(res, 200));
    }
  }

  setSnapshot({ state: 'disconnected' });
}

async function connect() {
  if (!('serial' in navigator)) {
    setSnapshot({ error: 'Web Serial not supported. Use Chrome or Edge.' });
    return;
  }
  try {
    setSnapshot({ error: null });
    const p = await navigator.serial.requestPort();
    await p.open({ baudRate: 9600, dataBits: 8, parity: 'none', stopBits: 1, flowControl: 'none' });
    port = p;
    setSnapshot({ portLabel: 'Scale (COM port)', state: 'connected' });
    localStorage.setItem(STORAGE_KEY, '1');
    console.log('[scale] connected');
    startListening(p);
  } catch (err) {
    if (err instanceof Error && err.name === 'NotFoundError') return;
    console.error('[scale] connect failed:', err);
    setSnapshot({ error: err instanceof Error ? err.message : 'Connection failed.' });
  }
}

async function autoConnect() {
  // Already connected (or mid-connect) from an earlier mount — nothing to do. This guard is
  // what makes autoConnect idempotent across remounts instead of trying to reopen a port the
  // browser still considers open, which previously failed and cleared the saved permission.
  if (port) return;
  if (!('serial' in navigator)) return;
  if (!localStorage.getItem(STORAGE_KEY)) return;
  try {
    const ports = await navigator.serial.getPorts();
    if (!ports[0]) return;
    await ports[0].open({ baudRate: 9600, dataBits: 8, parity: 'none', stopBits: 1, flowControl: 'none' });
    port = ports[0];
    setSnapshot({ portLabel: 'Scale (COM port)', state: 'connected' });
    console.log('[scale] auto-reconnected');
    startListening(ports[0]);
  } catch (err) {
    console.warn('[scale] auto-reconnect failed, clearing stored permission:', err);
    localStorage.removeItem(STORAGE_KEY);
  }
}

async function disconnect() {
  console.log('[scale] disconnect requested');
  active = false;
  await reader?.cancel().catch(() => {});
  await port?.close().catch(() => {});
  port = null;
  setSnapshot({ state: 'disconnected', portLabel: null });
}

export function useScale(onReading?: (r: ParsedReading) => void) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const listener = () => setTick((n) => n + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  // The singleton only ever dispatches to one handler at a time — whichever page is
  // currently mounted last wins, which is what we want: the page in front is the one
  // that should react to the next reading.
  useEffect(() => {
    onReadingCallback = onReading ?? null;
    setSnapshot({ listenerActive: onReadingCallback != null });
    return () => {
      if (onReadingCallback === onReading) {
        onReadingCallback = null;
        setSnapshot({ listenerActive: false });
      }
    };
  }, [onReading]);

  return {
    state: snapshot.state,
    error: snapshot.error,
    chunkCount: snapshot.chunkCount,
    portLabel: snapshot.portLabel,
    lastReading: snapshot.lastReading,
    lastRawBuffer: snapshot.lastRawBuffer,
    listenerActive: snapshot.listenerActive,
    connect,
    disconnect,
    autoConnect,
  };
}
