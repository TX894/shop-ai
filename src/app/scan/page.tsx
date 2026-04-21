"use client";

import { useState } from "react";
import Link from "next/link";
import type { ShopifyProduct, ScanResponse } from "@/types/shopify";
import ImportModal from "@/components/ImportModal";
import Header from "@/components/Header";

const PLATFORMS = [
  { name: "Shopify", active: true },
  { name: "Google Shopping", active: false },
  { name: "WooCommerce", active: false },
  { name: "Amazon", active: false },
  { name: "Magento", active: false },
  { name: "BigCommerce", active: false },
  { name: "Wix", active: false },
  { name: "OpenCart", active: false },
  { name: "PrestaShop", active: false },
  { name: "Temu", active: false },
  { name: "SHEIN", active: false },
  { name: "Etsy", active: false },
  { name: "AliExpress", active: false },
  { name: "Zalando", active: false },
];

export default function ScanPage() {
  const [storeUrl, setStoreUrl] = useState("");
  const [scanning, setScanning] = useState(false);
  const [products, setProducts] = useState<ShopifyProduct[]>([]);
  const [scannedDomain, setScannedDomain] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [showImportModal, setShowImportModal] = useState(false);

  async function handleScan() {
    if (!storeUrl.trim()) return;
    setScanning(true);
    setError("");
    setProducts([]);
    setSelected(new Set());

    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: storeUrl.trim() }),
      });
      const data = (await res.json()) as ScanResponse & { error?: string };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      setProducts(data.products);
      let domain = storeUrl.trim();
      if (!domain.startsWith("http")) domain = "https://" + domain;
      const parsed = new URL(domain);
      setScannedDomain(parsed.hostname.replace(/^www\./, ""));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setScanning(false);
    }
  }

  function toggleProduct(handle: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(handle)) next.delete(handle);
      else next.add(handle);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === products.length) setSelected(new Set());
    else setSelected(new Set(products.map((p) => p.handle)));
  }

  function lowestPrice(p: ShopifyProduct): string {
    if (!p.variants.length) return "—";
    const prices = p.variants.map((v) => parseFloat(v.price)).filter((n) => !isNaN(n));
    if (!prices.length) return "—";
    return `£${Math.min(...prices).toFixed(2)}`;
  }

  return (
    <>
    <Header />
    <main className="min-h-screen bg-stone-50 dark:bg-stone-950">
      <div className="max-w-7xl mx-auto p-6 md:p-10">
        <div className="flex gap-8">
          {/* LEFT — Main area (70%) */}
          <div className="flex-1 min-w-0">
            {/* Header */}
            <div className="mb-6">
              <h1 className="text-2xl font-semibold text-stone-900 dark:text-stone-100">Copy multi-product</h1>
              <p className="text-sm text-stone-500 dark:text-stone-400 mt-1">
                Copy a list of products from any Shopify store with a single click.
              </p>
            </div>

            {/* URL input */}
            <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-800 p-4 mb-6">
              <div className="flex gap-3">
                <input
                  type="text"
                  value={storeUrl}
                  onChange={(e) => setStoreUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleScan()}
                  placeholder="https://store.myshopify.com or /collections/..."
                  className="flex-1 px-4 py-2.5 border border-stone-300 dark:border-stone-700 rounded-xl text-sm bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 placeholder:text-stone-400"
                />
                <div className="relative">
                  <select disabled className="appearance-none px-3 py-2.5 border border-stone-200 rounded-lg text-sm bg-stone-50 text-stone-400 pr-8 cursor-not-allowed">
                    <option>Single store</option>
                    <option>Multi-store</option>
                  </select>
                </div>
                <button
                  type="button"
                  onClick={handleScan}
                  disabled={scanning || !storeUrl.trim()}
                  className="px-6 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap transition-colors"
                >
                  {scanning ? "Loading..." : "Load Products"}
                </button>
              </div>
            </div>

            {error && (
              <div className="mb-6 text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg p-3">
                {error}
              </div>
            )}

            {scanning && (
              <div className="text-center py-16 text-stone-500 text-sm">
                <div className="w-6 h-6 border-2 border-stone-200 border-t-indigo-600 rounded-full animate-spin mx-auto mb-3" />
                Loading products...
              </div>
            )}

            {/* Product grid */}
            {products.length > 0 && (
              <>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-4">
                    <span className="text-sm text-stone-600 font-medium">
                      {products.length} products · {selected.size} selected
                    </span>
                    <button onClick={toggleAll} className="text-xs text-indigo-600 hover:text-indigo-800 underline">
                      {selected.size === products.length ? "Deselect all" : "Select all"}
                    </button>
                  </div>
                  {selected.size > 0 && (
                    <button
                      onClick={() => setShowImportModal(true)}
                      className="px-5 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700"
                    >
                      Import {selected.size} Selected Product{selected.size !== 1 ? "s" : ""}
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {products.map((p) => {
                    const isSelected = selected.has(p.handle);
                    const img = p.images[0]?.src;
                    return (
                      <div
                        key={p.handle}
                        onClick={() => toggleProduct(p.handle)}
                        className={`relative bg-white dark:bg-stone-900 rounded-2xl border cursor-pointer overflow-hidden transition-all hover:shadow-md ${
                          isSelected
                            ? "border-indigo-500 ring-2 ring-indigo-500"
                            : "border-stone-200 dark:border-stone-800 hover:border-stone-300 dark:hover:border-stone-700"
                        }`}
                      >
                        {/* Checkbox */}
                        <div className="absolute top-2 left-2 z-10">
                          <div className={`w-5 h-5 rounded border-2 flex items-center justify-center ${isSelected ? "bg-indigo-600 border-indigo-600" : "bg-white border-stone-300"}`}>
                            {isSelected && (
                              <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </div>
                        </div>

                        {/* View link */}
                        <Link
                          href={`/scan/${p.handle}?store=${scannedDomain}`}
                          onClick={(e) => e.stopPropagation()}
                          className="absolute top-2 right-2 z-10 bg-white/80 rounded px-1.5 py-0.5 text-xs text-stone-600 hover:text-stone-900 border border-stone-200"
                        >
                          View
                        </Link>

                        <div className="aspect-square bg-stone-100">
                          {img ? (
                            <img src={img} alt={p.title} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-stone-400 text-xs">No image</div>
                          )}
                        </div>
                        <div className="p-2">
                          <p className="text-xs font-medium text-stone-800 line-clamp-2 leading-tight">{p.title}</p>
                          <p className="text-xs text-stone-500 mt-0.5">{lowestPrice(p)}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {/* RIGHT — Sidebar (30%) */}
          <div className="hidden lg:block w-64 flex-shrink-0">
            <div className="sticky top-6">
              <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl p-4">
                <h3 className="text-xs font-medium text-stone-500 uppercase tracking-wide mb-3">
                  Supported platforms
                </h3>
                <div className="space-y-2">
                  {PLATFORMS.map((p) => (
                    <div
                      key={p.name}
                      className={`flex items-center justify-between px-3 py-2 rounded ${
                        p.active
                          ? "bg-green-50 border border-green-200"
                          : "bg-stone-50 border border-stone-100"
                      }`}
                    >
                      <span className={`text-sm ${p.active ? "text-green-800 font-medium" : "text-stone-400"}`}>
                        {p.name}
                      </span>
                      {p.active ? (
                        <span className="text-green-600 text-xs font-medium">✓</span>
                      ) : (
                        <span className="text-[10px] text-stone-400 bg-stone-200 px-1.5 py-0.5 rounded">Soon</span>
                      )}
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-stone-400 mt-3 text-center">
                  <a href="#" className="underline hover:text-stone-600">Request new platform</a>
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Import modal */}
      <ImportModal
        open={showImportModal}
        onClose={() => setShowImportModal(false)}
        products={products.filter((p) => selected.has(p.handle))}
        selectedHandles={selected}
        sourceStore={scannedDomain}
      />
    </main>
    </>
  );
}
