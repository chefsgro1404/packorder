'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
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

export function useScale(onReading?: (r: ParsedReading) => void) {
  const [state, setState] = useState<ScaleState>('disconnected');
  const [error, setError] = useState<string | null>(null);
  const [chunkCount, setChunkCount] = useState(0);
  const [portLabel, setPortLabel] = useState<string | null>(null);
  const [lastReading, setLastReading] = useState<ParsedReading | null>(null);

  const portRef = useRef<SerialPort | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const activeRef = useRef(false);

  const startListening = useCallback(async (port: SerialPort) => {
    activeRef.current = true;

    while (activeRef.current) {
      let buffer = '';
      let lastReceive = Date.now();
      let chunks = 0;
      let streamDone = false;

      const reader = port.readable!.getReader();
      readerRef.current = reader;
      setState('receiving');

      // Wait for 2s silence to know the transmission is complete
      const checker = setInterval(() => {
        if (Date.now() - lastReceive > SILENCE_MS && buffer.length > 0) {
          streamDone = true;
          clearInterval(checker);
          reader.cancel().catch(() => {});
        }
      }, POLL_MS);

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += new TextDecoder('ascii').decode(value);
          lastReceive = Date.now();
          chunks += 1;
          setChunkCount(chunks);
        }
      } catch {
        // normal — reader was cancelled by silence detector
      } finally {
        clearInterval(checker);
        reader.releaseLock();
        readerRef.current = null;
      }

      if (!activeRef.current) break;

      if (streamDone && buffer.length > 0) {
        setState('processing');
        const result = parseScaleBuffer(buffer);
        console.log(`[scale] received ${chunks} chunk(s), ${buffer.length} bytes:`, JSON.stringify(buffer));

        if (result.success && result.itemName && result.itemWeight && result.qrPayload) {
          const reading: ParsedReading = {
            itemName: result.itemName,
            itemNumber: result.itemNumber ?? '',
            itemWeight: result.itemWeight,
            qrPayload: result.qrPayload,
            rawBuffer: buffer,
            timestamp: new Date(),
          };
          console.log('[scale] parsed reading:', reading.itemName, reading.itemNumber, reading.itemWeight);
          setLastReading(reading);
          setError(null);
          onReading?.(reading);
        } else if (result.error === 'OVERLOAD') {
          console.warn('[scale] OVERLOAD reported by scale');
          setError('Scale overload — remove excess weight and try again.');
        } else if (result.error === 'NO_ITEM') {
          console.warn('[scale] no ITEM line found in buffer:', JSON.stringify(buffer));
          setError('No item data received. Trigger the scale again.');
        } else {
          console.error('[scale] failed to parse buffer:', JSON.stringify(buffer), 'error:', result.error);
          setError('Could not parse scale data. Try again.');
        }
      }

      if (activeRef.current) {
        setState('connected');
        setChunkCount(0);
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    setState('disconnected');
  }, [onReading]);

  const connect = useCallback(async () => {
    if (!('serial' in navigator)) {
      setError('Web Serial not supported. Use Chrome or Edge.');
      return;
    }
    try {
      setError(null);
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate: 9600, dataBits: 8, parity: 'none', stopBits: 1, flowControl: 'none' });
      portRef.current = port;
      setPortLabel('Scale (COM port)');
      setState('connected');
      localStorage.setItem(STORAGE_KEY, '1');
      console.log('[scale] connected');
      startListening(port);
    } catch (err) {
      if (err instanceof Error && err.name === 'NotFoundError') return;
      console.error('[scale] connect failed:', err);
      setError(err instanceof Error ? err.message : 'Connection failed.');
    }
  }, [startListening]);

  const autoConnect = useCallback(async () => {
    if (!('serial' in navigator)) return;
    if (!localStorage.getItem(STORAGE_KEY)) return;
    try {
      const ports = await navigator.serial.getPorts();
      if (!ports[0]) return;
      await ports[0].open({ baudRate: 9600, dataBits: 8, parity: 'none', stopBits: 1, flowControl: 'none' });
      portRef.current = ports[0];
      setPortLabel('Scale (COM port)');
      setState('connected');
      console.log('[scale] auto-reconnected');
      startListening(ports[0]);
    } catch (err) {
      console.warn('[scale] auto-reconnect failed, clearing stored permission:', err);
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [startListening]);

  const disconnect = useCallback(async () => {
    console.log('[scale] disconnect requested');
    activeRef.current = false;
    readerRef.current?.cancel().catch(() => {});
    await portRef.current?.close().catch(() => {});
    portRef.current = null;
    setState('disconnected');
    setPortLabel(null);
  }, []);

  useEffect(() => () => {
    activeRef.current = false;
    readerRef.current?.cancel().catch(() => {});
  }, []);

  return { state, connect, disconnect, autoConnect, lastReading, error, chunkCount, portLabel };
}
