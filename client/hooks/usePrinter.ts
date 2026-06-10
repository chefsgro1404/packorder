'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { buildEZPL } from '@/lib/ezpl';

export type PrinterState = 'disconnected' | 'connected' | 'printing' | 'error';

const STORAGE_KEY = 'shipscale_printer_granted';

export function usePrinter() {
  const [state, setState] = useState<PrinterState>('disconnected');
  const [error, setError] = useState<string | null>(null);
  const [lastPrintedAt, setLastPrintedAt] = useState<Date | null>(null);
  const [portLabel, setPortLabel] = useState<string | null>(null);
  const portRef = useRef<SerialPort | null>(null);

  const connect = useCallback(async () => {
    if (!('serial' in navigator)) {
      setError('Web Serial not supported. Use Chrome or Edge.');
      return;
    }
    try {
      setError(null);
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate: 9600 });
      portRef.current = port;
      setPortLabel('Godex DT2x');
      setState('connected');
      localStorage.setItem(STORAGE_KEY, '1');
      console.log('[printer] connected');
    } catch (err) {
      if (err instanceof Error && err.name === 'NotFoundError') return;
      console.error('[printer] connect failed:', err);
      setError(err instanceof Error ? err.message : 'Printer connection failed.');
      setState('error');
    }
  }, []);

  const autoConnect = useCallback(async () => {
    if (!('serial' in navigator)) return;
    if (!localStorage.getItem(STORAGE_KEY)) return;
    try {
      const ports = await navigator.serial.getPorts();
      const port = ports[ports.length - 1]; // printer is last granted port
      if (!port) return;
      await port.open({ baudRate: 9600 });
      portRef.current = port;
      setPortLabel('Godex DT2x');
      setState('connected');
      console.log('[printer] auto-reconnected');
    } catch (err) {
      console.warn('[printer] auto-reconnect failed, clearing stored permission:', err);
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const disconnect = useCallback(async () => {
    console.log('[printer] disconnect requested');
    await portRef.current?.close().catch(() => {});
    portRef.current = null;
    setState('disconnected');
    setPortLabel(null);
  }, []);

  const print = useCallback(async (productTitle: string, qrPayload: string) => {
    if (!portRef.current) {
      console.error('[printer] print requested but no port connected:', productTitle, qrPayload);
      setError('Printer not connected.');
      return;
    }
    setState('printing');
    setError(null);
    const writer = portRef.current.writable!.getWriter();
    try {
      await writer.write(buildEZPL(productTitle, qrPayload));
      console.log('[printer] printed:', productTitle, '| QR:', qrPayload);
      setLastPrintedAt(new Date());
      setState('connected');
    } catch (err) {
      console.error('[printer] print failed:', err, '| product:', productTitle, '| QR:', qrPayload);
      setError(err instanceof Error ? err.message : 'Print failed.');
      setState('error');
    } finally {
      writer.releaseLock();
    }
  }, []);

  useEffect(() => () => { portRef.current?.close().catch(() => {}); }, []);

  return { state, connect, disconnect, autoConnect, print, lastPrintedAt, error, portLabel };
}
