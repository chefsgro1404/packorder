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
    } catch (err) {
      if (err instanceof Error && err.name === 'NotFoundError') return;
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
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const disconnect = useCallback(async () => {
    await portRef.current?.close().catch(() => {});
    portRef.current = null;
    setState('disconnected');
    setPortLabel(null);
  }, []);

  const print = useCallback(async (itemName: string, itemWeight: string) => {
    if (!portRef.current) { setError('Printer not connected.'); return; }
    setState('printing');
    setError(null);
    const writer = portRef.current.writable!.getWriter();
    try {
      await writer.write(buildEZPL(itemName, itemWeight));
      setLastPrintedAt(new Date());
      setState('connected');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Print failed.');
      setState('error');
    } finally {
      writer.releaseLock();
    }
  }, []);

  useEffect(() => () => { portRef.current?.close().catch(() => {}); }, []);

  return { state, connect, disconnect, autoConnect, print, lastPrintedAt, error, portLabel };
}
