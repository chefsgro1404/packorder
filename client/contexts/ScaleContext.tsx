'use client';

import { createContext, useContext, useRef, useCallback, useEffect, type ReactNode } from 'react';
import { useScale, type ParsedReading, type ScaleState } from '@/hooks/useScale';

interface ScaleContextValue {
  state: ScaleState;
  error: string | null;
  chunkCount: number;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  /** Registers the callback that receives the next scale reading. Pages under
   * /scale call this on mount and clear it (pass null) on unmount, so the single
   * underlying serial connection survives client-side navigation between
   * /scale, /scale/products, and /scale/products/[id] instead of being torn
   * down and reopened (which fails — Web Serial rejects re-opening a port
   * that's still open from a previous page, clearing the saved permission). */
  setReadingHandler: (handler: ((reading: ParsedReading) => void) | null) => void;
}

const ScaleContext = createContext<ScaleContextValue | null>(null);

export function ScaleProvider({ children }: { children: ReactNode }) {
  const handlerRef = useRef<((reading: ParsedReading) => void) | null>(null);

  const dispatchReading = useCallback((reading: ParsedReading) => {
    handlerRef.current?.(reading);
  }, []);

  const scale = useScale(dispatchReading);

  const setReadingHandler = useCallback((handler: ((reading: ParsedReading) => void) | null) => {
    handlerRef.current = handler;
  }, []);

  useEffect(() => {
    scale.autoConnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <ScaleContext.Provider
      value={{
        state: scale.state,
        error: scale.error,
        chunkCount: scale.chunkCount,
        connect: scale.connect,
        disconnect: scale.disconnect,
        setReadingHandler,
      }}
    >
      {children}
    </ScaleContext.Provider>
  );
}

export function useScaleContext() {
  const ctx = useContext(ScaleContext);
  if (!ctx) throw new Error('useScaleContext must be used within a ScaleProvider');
  return ctx;
}
