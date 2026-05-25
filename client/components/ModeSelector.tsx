"use client";

import { useRouter } from "next/navigation";
import { ShoppingCart, Truck, Tag } from "lucide-react";
import { useEffect, useState } from "react";

type Mode = "pos" | "ship" | "assign";

interface ModeConfig {
  id: Mode;
  label: string;
  description: string;
  icon: React.ReactNode;
  activeColor: string;
  badgeColor: string;
  iconBg: string;
  iconColor: string;
}

const MODES: ModeConfig[] = [
  {
    id: "pos",
    label: "POS Mode",
    description: "Scan products & checkout",
    icon: <ShoppingCart className="w-8 h-8 text-blue-400" />,
    activeColor: "border-blue-500 bg-blue-950/50",
    badgeColor: "bg-blue-600",
    iconBg: "bg-blue-600/20",
    iconColor: "text-blue-400",
  },
  {
    id: "ship",
    label: "Ship Mode",
    description: "Scan packages & fulfill orders",
    icon: <Truck className="w-8 h-8 text-green-400" />,
    activeColor: "border-green-500 bg-green-950/50",
    badgeColor: "bg-green-600",
    iconBg: "bg-green-600/20",
    iconColor: "text-green-400",
  },
  {
    id: "assign",
    label: "Assign Barcode",
    description: "Link barcodes to products",
    icon: <Tag className="w-8 h-8 text-purple-400" />,
    activeColor: "border-purple-500 bg-purple-950/50",
    badgeColor: "bg-purple-600",
    iconBg: "bg-purple-600/20",
    iconColor: "text-purple-400",
  },
];

export function ModeSelector() {
  const router = useRouter();
  const [lastMode, setLastMode] = useState<string | null>(null);

  useEffect(() => {
    setLastMode(localStorage.getItem("shipscan_last_mode"));
  }, []);

  const selectMode = (mode: Mode) => {
    localStorage.setItem("shipscan_last_mode", mode);
    router.push(`/${mode}`);
  };

  return (
    <div className="grid grid-cols-1 gap-3 w-full max-w-sm">
      {MODES.map((mode) => (
        <button
          key={mode.id}
          onClick={() => selectMode(mode.id)}
          className={`relative flex items-center gap-4 px-5 py-4 rounded-2xl border-2 transition-all duration-200 active:scale-[0.97] min-h-[80px] ${
            lastMode === mode.id
              ? mode.activeColor
              : "border-slate-700 bg-slate-900 hover:border-slate-500"
          }`}
        >
          {lastMode === mode.id && (
            <span
              className={`absolute top-2.5 right-3 text-xs px-2 py-0.5 rounded-full ${mode.badgeColor}`}
            >
              Last used
            </span>
          )}
          <div
            className={`w-12 h-12 rounded-xl ${mode.iconBg} flex items-center justify-center shrink-0`}
          >
            {mode.icon}
          </div>
          <div className="text-left">
            <h2 className="text-base font-bold text-slate-100">{mode.label}</h2>
            <p className="text-xs text-slate-400 mt-0.5">{mode.description}</p>
          </div>
        </button>
      ))}
    </div>
  );
}
