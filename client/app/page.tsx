"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ModeSelector } from "@/components/ModeSelector";
import { StatusBanner } from "@/components/StatusBanner";
import { Package } from "lucide-react";

type AuthState = "checking" | "authenticated" | "unauthenticated";

export default function HomePage() {
  const router = useRouter();
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check whether an active session cookie already exists
  useEffect(() => {
    fetch("/api/auth")
      .then((res) => {
        setAuthState(res.ok ? "authenticated" : "unauthenticated");
      })
      .catch(() => {
        setAuthState("unauthenticated");
      });
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (res.ok) {
        setAuthState("authenticated");
        setEmail("");
        setPassword("");
      } else {
        setError("Invalid email or password.");
        navigator.vibrate?.([50, 30, 50]);
      }
    } catch {
      setError("Network error. Check your connection.");
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await fetch("/api/auth", { method: "DELETE" });
    setAuthState("unauthenticated");
    router.refresh();
  };

  // Silent check on first load — show nothing until resolved
  if (authState === "checking") {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-950">
        <div className="flex gap-2">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="w-2 h-2 rounded-full bg-slate-600 animate-bounce"
              style={{ animationDelay: `${i * 150}ms` }}
            />
          ))}
        </div>
      </main>
    );
  }

  if (authState === "unauthenticated") {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center p-6 bg-slate-950">
        <div className="w-full max-w-sm space-y-8">
          <div className="text-center space-y-2">
            <div className="w-16 h-16 rounded-2xl bg-blue-600/20 flex items-center justify-center mx-auto">
              <Package className="w-8 h-8 text-blue-400" />
            </div>
            <h1 className="text-2xl font-bold text-slate-100">
              {process.env.NEXT_PUBLIC_APP_NAME || "ShipScan"}
            </h1>
            <p className="text-slate-400 text-sm" suppressHydrationWarning>
              {process.env.NEXT_PUBLIC_APP_NAME || "ShipScan"}
            </p>
          </div>

          <form onSubmit={handleLogin} className="space-y-3">
            <div>
              <label className="block text-xs text-slate-400 mb-2 font-medium uppercase tracking-wide">
                Email
              </label>
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full px-4 py-3.5 bg-slate-900 border border-slate-700 rounded-xl text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[52px]"
                autoFocus
              />
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-2 font-medium uppercase tracking-wide">
                Password
              </label>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-4 py-3.5 bg-slate-900 border border-slate-700 rounded-xl text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[52px]"
              />
            </div>

            {error && (
              <StatusBanner type="error" message={error} autoDismiss={3000} onDismiss={() => setError(null)} />
            )}

            <button
              type="submit"
              disabled={loading || !email || !password}
              className="w-full py-4 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-xl font-bold text-base transition-all min-h-[56px]"
            >
              {loading ? "Signing in…" : "Sign In"}
            </button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6 bg-slate-950">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center space-y-1">
          <div className="w-12 h-12 rounded-xl bg-blue-600/20 flex items-center justify-center mx-auto mb-3">
            <Package className="w-6 h-6 text-blue-400" />
          </div>
          <h1 className="text-xl font-bold text-slate-100">
            {process.env.NEXT_PUBLIC_APP_NAME || "ShipScan"}
          </h1>
          <p className="text-slate-500 text-xs">Select a mode to begin</p>
        </div>

        <ModeSelector />

        <button
          onClick={handleLogout}
          className="w-full py-2 text-slate-500 hover:text-slate-300 text-sm transition-colors"
        >
          Log out
        </button>
      </div>
    </main>
  );
}
