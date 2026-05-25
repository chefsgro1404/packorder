"use client";

import { useEffect, useState } from "react";
import { CheckCircle, XCircle, AlertTriangle, Info } from "lucide-react";

type BannerType = "success" | "error" | "warning" | "info";

interface StatusBannerProps {
  type: BannerType;
  message: string;
  autoDismiss?: number;
  onDismiss?: () => void;
}

const styles: Record<BannerType, string> = {
  success: "bg-green-900/80 border-green-500 text-green-100",
  error: "bg-red-900/80 border-red-500 text-red-100",
  warning: "bg-orange-900/80 border-orange-500 text-orange-100",
  info: "bg-blue-900/80 border-blue-500 text-blue-100",
};

const icons: Record<BannerType, React.ReactNode> = {
  success: <CheckCircle className="w-5 h-5 shrink-0" />,
  error: <XCircle className="w-5 h-5 shrink-0" />,
  warning: <AlertTriangle className="w-5 h-5 shrink-0" />,
  info: <Info className="w-5 h-5 shrink-0" />,
};

export function StatusBanner({ type, message, autoDismiss, onDismiss }: StatusBannerProps) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (!autoDismiss) return;
    const t = setTimeout(() => {
      setVisible(false);
      onDismiss?.();
    }, autoDismiss);
    return () => clearTimeout(t);
  }, [autoDismiss, onDismiss]);

  if (!visible) return null;

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-sm font-medium transition-all duration-300 ${styles[type]}`}
    >
      {icons[type]}
      <span>{message}</span>
    </div>
  );
}
