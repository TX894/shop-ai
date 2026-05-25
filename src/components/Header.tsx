"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Sun, Moon, Library, Scan, Settings, Store as StoreIcon, ChevronDown, Sparkles, BookmarkPlus } from "lucide-react";

const NAV_ITEMS = [
  { href: "/scan", label: "Scan", icon: Scan },
  { href: "/extension", label: "Bookmarklet", icon: BookmarkPlus },
  { href: "/library", label: "Library", icon: Library },
  { href: "/settings", label: "Settings", icon: Settings },
];

interface StoreRow {
  id: string;
  name: string;
  domain: string;
  is_active: boolean;
  brand_brief: string | null;
}

export default function Header() {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    fetch("/api/stores").then((r) => r.json()).then((d) => {
      if (Array.isArray(d.stores)) setStores(d.stores);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [menuOpen]);

  async function handleActivate(id: string) {
    setMenuOpen(false);
    try {
      await fetch(`/api/stores/${id}/activate`, { method: "POST" });
      // Reload to ensure server state propagates
      window.location.reload();
    } catch { /* ignore */ }
  }

  const activeStore = stores.find((s) => s.is_active);

  return (
    <header className="sticky top-0 z-40 border-b border-stone-200 dark:border-stone-800 bg-white/80 dark:bg-stone-950/80 backdrop-blur-lg">
      <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between gap-4">
        {/* Wordmark + store switcher */}
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-1.5">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white">
              <Sparkles size={14} />
            </div>
            <span className="text-lg font-bold tracking-tight text-stone-900 dark:text-stone-100">
              Shop<span className="text-indigo-600 dark:text-indigo-400">AI</span>
            </span>
          </Link>

          {/* Store switcher */}
          {stores.length > 0 && (
            <div className="relative ml-1 hidden md:block">
              <button
                onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); }}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 text-sm transition"
                title={activeStore?.brand_brief ?? undefined}
              >
                <StoreIcon size={13} className="text-stone-500" />
                <span className="font-medium text-stone-800 dark:text-stone-200 max-w-[160px] truncate">
                  {activeStore?.name ?? "No store"}
                </span>
                <ChevronDown size={13} className="text-stone-400" />
              </button>
              {menuOpen && (
                <div className="absolute left-0 top-10 bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 rounded-xl shadow-xl z-20 py-1 min-w-[240px] overflow-hidden">
                  <p className="text-[10px] uppercase tracking-wider text-stone-400 px-3 pt-2 pb-1">Switch active store</p>
                  {stores.map((s) => (
                    <button key={s.id} onClick={() => handleActivate(s.id)} className={`w-full text-left px-3 py-2 hover:bg-stone-100 dark:hover:bg-stone-800 flex items-center justify-between gap-2 ${s.is_active ? "bg-indigo-50/60 dark:bg-indigo-900/20" : ""}`}>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-stone-800 dark:text-stone-200 truncate">{s.name}</p>
                        <p className="text-[11px] text-stone-500 truncate">{s.domain}</p>
                      </div>
                      {s.is_active && <span className="text-[10px] bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 px-1.5 py-0.5 rounded font-medium">ACTIVE</span>}
                    </button>
                  ))}
                  <div className="border-t border-stone-100 dark:border-stone-800 mt-1">
                    <Link href="/settings" className="block px-3 py-2 text-xs text-indigo-600 dark:text-indigo-400 hover:bg-stone-50 dark:hover:bg-stone-800">+ Add or edit stores</Link>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex items-center gap-1">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const isActive = pathname.startsWith(href);
            return (
              <Link key={href} href={href} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                isActive ? "bg-stone-100 dark:bg-stone-800 text-stone-900 dark:text-stone-100 font-medium" : "text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 hover:bg-stone-50 dark:hover:bg-stone-900"
              }`}>
                <Icon size={16} />
                <span className="hidden sm:inline">{label}</span>
              </Link>
            );
          })}
          {mounted && (
            <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")} className="ml-2 p-2 rounded-lg text-stone-500 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors" aria-label="Toggle theme">
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          )}
        </nav>
      </div>
    </header>
  );
}
