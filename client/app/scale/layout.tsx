'use client';

import { ScaleProvider } from '@/contexts/ScaleContext';

export default function ScaleLayout({ children }: { children: React.ReactNode }) {
  return <ScaleProvider>{children}</ScaleProvider>;
}
