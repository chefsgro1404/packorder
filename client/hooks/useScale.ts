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
const STORAGE_KEY = 'shipscale_scale_granted';

// Module-level singleton — the actual port/reader and connection state live here, not in
// any React component. Pages under /scale each call useScale(), but a Next.js route change
// can remount the component tree (e.g. transitioning into a dynamic [id] segment); if the
// connection lived in per-component state/refs, that remount would silently lose it and the
// next page would have to reopen a port that — from the browser's perspective — never closed.
// Living outside React, the connection survives any number of mounts/unmounts.
interface ScaleSnapshot {
  state: ScaleState;
  error: string | null;
  chunkCount: number;
  portLabel: string | null;
  lastReading: ParsedReading | null;
}

let snapshot: ScaleSnapshot = {
  state: 'disconnected',
  error: null,
  chunkCount: 0,
  portLabel: null,
  lastReading: null,
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

    // Wait for 2s silence to know the transmission is complete
    const checker = setInterval(() => {
      if (Date.now() - lastReceive > SILENCE_MS && buffer.length > 0) {
        streamDone = true;
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

    if (streamDone && buffer.length > 0) {
      setSnapshot({ state: 'processing' });
      const result = parseScaleBuffer(buffer);
      console.log(`[scale] received ${chunks} chunk(s), ${buffer.length} bytes:`, JSON.stringify(buffer));

      if (result.success && result.itemName && result.itemWeight && result.qrPayload) {
        const parsedReading: ParsedReading = {
          itemName: result.itemName,
          itemNumber: result.itemNumber ?? '',
          itemWeight: result.itemWeight,
          qrPayload: result.qrPayload,
          rawBuffer: buffer,
          timestamp: new Date(),
        };
        console.log('[scale] parsed reading:', parsedReading.itemName, parsedReading.itemNumber, parsedReading.itemWeight);
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
    return () => {
      if (onReadingCallback === onReading) onReadingCallback = null;
    };
  }, [onReading]);

  return {
    state: snapshot.state,
    error: snapshot.error,
    chunkCount: snapshot.chunkCount,
    portLabel: snapshot.portLabel,
    lastReading: snapshot.lastReading,
    connect,
    disconnect,
    autoConnect,
  };
}
