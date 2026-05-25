"use client";

/**
 * Landing page the Temu / supplier bookmarklet redirects to.
 * Reads the scraped product from the URL fragment (#data=<encoded>),
 * shows a preview + a slim options form, then streams the import via
 * /api/import/external.
 */

import { useEffect, useState, Suspense } from "react";
import Header from "@/components/Header";
import type { ExternalProduct, ExternalImportEvent } from "@/types/external-import";
import { Sparkles, Loader2, Check, ExternalLink as LinkIcon, ArrowLeft } from "lucide-react";

const LANGUAGES = [
  { value: "fr", label: "Français" },
  { value: "pt", label: "Português (PT)" },
  { value: "en", label: "English" },
  { value: "es", label: "Español" },
  { value: "de", label: "Deutsch" },
  { value: "it", label: "Italiano" },
];

type Phase = "config" | "importing" | "done";

function ImportExternalInner() {
  const [product, setProduct] = useState<ExternalProduct | null>(null);
  const [hashError, setHashError] = useState<string | null>(null);

  // Options (defaults match the most useful Shopify-policy-safe setup)
  const [language, setLanguage] = useState("fr");
  const [translateEnabled, setTranslateEnabled] = useState(true);
  const [translateImagesEnabled, setTranslateImagesEnabled] = useState(true);
  const [enhanceTitle, setEnhanceTitle] = useState(true);
  const [enhanceDescription, setEnhanceDescription] = useState(true);
  const [seoEnabled, setSeoEnabled] = useState(true);
  const [watermarkEnabled, setWatermarkEnabled] = useState(true);
  const [maxImages, setMaxImages] = useState(10);
  const [pricingMode, setPricingMode] = useState<"original" | "fixed" | "markup">("fixed");
  const [fixedPrice, setFixedPrice] = useState("29.95");
  const [markupPercent, setMarkupPercent] = useState("100");
  const [productStatus, setProductStatus] = useState<"DRAFT" | "ACTIVE">("DRAFT");
  const [publishMode, setPublishMode] = useState<"online-store" | "all" | "none">("online-store");
  const [tags, setTags] = useState("temu, imported");

  // Run state
  const [phase, setPhase] = useState<Phase>("config");
  const [currentStep, setCurrentStep] = useState("");
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [adminUrl, setAdminUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [translationStats, setTranslationStats] = useState<{ translated: number; total: number } | null>(null);
  const [kieCredits, setKieCredits] = useState<number | null>(null);

  // Parse the hash payload on mount
  useEffect(() => {
    try {
      const hash = window.location.hash;
      if (!hash || hash.length < 2) {
        setHashError("No product data in the URL. Open a Temu product page and click the bookmarklet.");
        return;
      }
      const params = new URLSearchParams(hash.slice(1));
      const raw = params.get("data");
      if (!raw) {
        setHashError("Missing data= parameter in the URL fragment.");
        return;
      }
      const decoded = JSON.parse(decodeURIComponent(escape(atob(raw)))) as ExternalProduct;
      if (!decoded.title || !Array.isArray(decoded.imageUrls)) {
        setHashError("Payload is missing title or imageUrls.");
        return;
      }
      setProduct(decoded);
    } catch (err) {
      setHashError(`Couldn't read the product data: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  // Check kie.ai credits
  useEffect(() => {
    fetch("/api/kie-credits")
      .then((r) => r.json())
      .then((d: { ok: boolean; credits: number | null }) => setKieCredits(d.ok ? d.credits : null))
      .catch(() => setKieCredits(null));
  }, []);

  async function handleImport() {
    if (!product) return;
    setPhase("importing");
    setCurrentStep("Starting...");
    setProgress({ current: 0, total: 0 });
    setError(null);
    setAdminUrl(null);
    setTranslationStats(null);

    try {
      const res = await fetch("/api/import/external", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product,
          options: {
            language,
            translateEnabled,
            translateImagesEnabled,
            enhanceTitleEnabled: enhanceTitle,
            enhanceDescriptionEnabled: enhanceDescription,
            seoEnabled,
            watermarkEnabled,
            maxImages,
            pricingMode,
            fixedPrice: pricingMode === "fixed" ? fixedPrice : undefined,
            markupPercent: pricingMode === "markup" ? parseFloat(markupPercent) || 0 : undefined,
            productStatus,
            publishMode,
            tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
          },
        }),
      });

      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const blocks = buf.split("\n\n");
        buf = blocks.pop() ?? "";
        for (const block of blocks) {
          const line = block.trim();
          if (!line.startsWith("data: ")) continue;
          try {
            const ev = JSON.parse(line.slice(6)) as ExternalImportEvent;
            if (ev.type === "step") {
              const labels: Record<string, string> = {
                translating: "Translating text...",
                "enhancing-title": "Polishing title...",
                "enhancing-description": "Writing description...",
                "seo-bundle": "Generating SEO meta...",
                "generating-images": "Processing images...",
                "image-done": "Image ready",
                "translation-summary": "Image translation done",
                "creating-shopify": "Pushing to Shopify (+ publishing)...",
              };
              setCurrentStep(labels[ev.step ?? ""] ?? ev.step ?? "");
              if (ev.progress) setProgress(ev.progress);
              if (ev.step === "translation-summary" && ev.progress) {
                setTranslationStats({ translated: ev.progress.current, total: ev.progress.total });
              }
            } else if (ev.type === "product-done") {
              setAdminUrl(ev.result?.adminUrl ?? null);
            } else if (ev.type === "product-error") {
              setError(ev.error ?? "Unknown error");
            }
          } catch { /* ignore */ }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    }
    setPhase("done");
  }

  if (hashError) {
    return (
      <>
        <Header />
        <main className="min-h-screen bg-stone-50 dark:bg-stone-950 p-6 md:p-10">
          <div className="max-w-2xl mx-auto bg-white dark:bg-stone-900 border border-red-200 dark:border-red-800 rounded-2xl p-6">
            <h1 className="text-lg font-semibold text-red-700 dark:text-red-400 mb-2">No product data</h1>
            <p className="text-sm text-stone-600 dark:text-stone-400 mb-4">{hashError}</p>
            <a href="/extension" className="text-sm text-indigo-600 hover:underline">← Get the bookmarklet</a>
          </div>
        </main>
      </>
    );
  }

  if (!product) {
    return (
      <>
        <Header />
        <main className="min-h-screen bg-stone-50 dark:bg-stone-950 p-6 md:p-10">
          <div className="max-w-2xl mx-auto text-center text-sm text-stone-500">Loading...</div>
        </main>
      </>
    );
  }

  return (
    <>
      <Header />
      <main className="min-h-screen bg-gradient-to-br from-stone-50 to-stone-100 dark:from-stone-950 dark:to-stone-900 p-6 md:p-10">
        <div className="max-w-4xl mx-auto">
          <a href="/scan" className="inline-flex items-center gap-1.5 text-xs text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 mb-3"><ArrowLeft size={13} /> Back to Scan</a>
          <h1 className="text-3xl font-semibold tracking-tight text-stone-900 dark:text-stone-100 mb-1">External import</h1>
          <p className="text-sm text-stone-500 mb-6">
            From <a href={product.sourceUrl} target="_blank" rel="noopener" className="underline">{product.sourceBrand}</a> · {product.imageUrls.length} image{product.imageUrls.length !== 1 ? "s" : ""} found
          </p>

          {phase === "config" && (
            <div className="grid grid-cols-1 md:grid-cols-[1.2fr_1fr] gap-6">
              {/* PRODUCT PREVIEW */}
              <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl p-5">
                <h2 className="text-xs font-medium text-stone-500 uppercase tracking-wider mb-3">Product preview</h2>
                <h3 className="text-base font-medium text-stone-900 dark:text-stone-100 mb-1">{product.title}</h3>
                {product.priceOriginal && (
                  <p className="text-sm text-stone-600 dark:text-stone-400 mb-3">
                    Source price: {product.priceCurrency ?? ""}{product.priceOriginal}
                  </p>
                )}
                <div className="grid grid-cols-3 gap-2 max-h-72 overflow-auto">
                  {product.imageUrls.slice(0, 12).map((url, i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={i} src={url} alt="" className="aspect-square object-cover rounded-md bg-stone-100" />
                  ))}
                </div>
                {product.descriptionHtml && (
                  <div className="mt-4">
                    <p className="text-[10px] uppercase tracking-wider text-stone-400 mb-1">Description (source)</p>
                    <div
                      className="text-xs text-stone-600 dark:text-stone-400 max-h-32 overflow-auto prose prose-sm dark:prose-invert"
                      dangerouslySetInnerHTML={{ __html: product.descriptionHtml }}
                    />
                  </div>
                )}
              </div>

              {/* OPTIONS */}
              <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl p-5 space-y-4">
                <h2 className="text-xs font-medium text-stone-500 uppercase tracking-wider">Import options</h2>

                <div>
                  <label className="block text-xs font-medium text-stone-700 dark:text-stone-300 mb-1.5">Language</label>
                  <select value={language} onChange={(e) => setLanguage(e.target.value)} className={inputCls}>
                    {LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                  </select>
                </div>

                <div className="space-y-2">
                  <Toggle checked={translateEnabled} onChange={setTranslateEnabled} label="Translate text" />
                  <Toggle checked={enhanceTitle} onChange={setEnhanceTitle} label="Polish title for SEO" />
                  <Toggle checked={enhanceDescription} onChange={setEnhanceDescription} label="Rewrite description" />
                  <Toggle checked={seoEnabled} onChange={setSeoEnabled} label="Generate SEO bundle" />
                  <Toggle checked={translateImagesEnabled} onChange={setTranslateImagesEnabled} label={`Translate text inside images (${maxImages * 4} kie.ai credits)`} />
                  <Toggle checked={watermarkEnabled} onChange={setWatermarkEnabled} label="Add brand watermark" />
                </div>

                <div>
                  <label className="block text-xs font-medium text-stone-700 dark:text-stone-300 mb-1.5">
                    Max images: <span className="text-stone-500">{maxImages}</span>
                  </label>
                  <input type="range" min={1} max={20} value={maxImages} onChange={(e) => setMaxImages(parseInt(e.target.value, 10))} className="w-full" />
                </div>

                <div>
                  <label className="block text-xs font-medium text-stone-700 dark:text-stone-300 mb-1.5">Pricing</label>
                  <div className="grid grid-cols-3 gap-1.5 mb-2">
                    {(["original", "fixed", "markup"] as const).map((m) => (
                      <button key={m} onClick={() => setPricingMode(m)} className={`text-xs py-1.5 px-2 rounded-lg border transition ${pricingMode === m ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700" : "border-stone-200 dark:border-stone-700"}`}>{m}</button>
                    ))}
                  </div>
                  {pricingMode === "fixed" && (
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-stone-500">€</span>
                      <input type="text" value={fixedPrice} onChange={(e) => setFixedPrice(e.target.value)} className={inputCls + " w-28"} />
                    </div>
                  )}
                  {pricingMode === "markup" && (
                    <div className="flex items-center gap-2">
                      <input type="text" value={markupPercent} onChange={(e) => setMarkupPercent(e.target.value)} className={inputCls + " w-20"} />
                      <span className="text-sm text-stone-500">% over source price</span>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-medium text-stone-700 dark:text-stone-300 mb-1.5">Tags (comma-separated)</label>
                  <input type="text" value={tags} onChange={(e) => setTags(e.target.value)} className={inputCls} />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => setProductStatus("DRAFT")} className={`py-2 px-3 rounded-lg border text-sm transition ${productStatus === "DRAFT" ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700" : "border-stone-200 dark:border-stone-700"}`}>📝 Draft</button>
                  <button onClick={() => setProductStatus("ACTIVE")} className={`py-2 px-3 rounded-lg border text-sm transition ${productStatus === "ACTIVE" ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700" : "border-stone-200 dark:border-stone-700"}`}>🟢 Active</button>
                </div>

                <select value={publishMode} onChange={(e) => setPublishMode(e.target.value as "online-store" | "all" | "none")} className={inputCls}>
                  <option value="online-store">Publish to Online Store</option>
                  <option value="all">Publish to all channels</option>
                  <option value="none">Admin only (don&apos;t publish)</option>
                </select>

                {kieCredits !== null && kieCredits <= 0 && (
                  <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-2.5 text-xs text-red-800 dark:text-red-300">
                    ⛔ kie.ai has 0 credits. Image translation will silently fail. Top up at <a href="https://kie.ai" target="_blank" rel="noopener" className="underline font-medium">kie.ai</a>.
                  </div>
                )}

                <button
                  onClick={handleImport}
                  className="w-full inline-flex items-center justify-center gap-2 bg-gradient-to-br from-indigo-600 to-violet-600 text-white py-3 rounded-xl text-sm font-medium hover:from-indigo-700 hover:to-violet-700 shadow-sm"
                >
                  <Sparkles size={14} /> Import to Shopify
                </button>
                {kieCredits !== null && kieCredits > 0 && (
                  <p className="text-[11px] text-stone-400 text-center">kie.ai: {kieCredits} credits</p>
                )}
              </div>
            </div>
          )}

          {phase === "importing" && (
            <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl p-8 max-w-md mx-auto text-center">
              <div className="w-12 h-12 rounded-full bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center mx-auto mb-4">
                <Loader2 className="text-indigo-600 animate-spin" size={24} />
              </div>
              <p className="text-base font-medium text-stone-900 dark:text-stone-100">{currentStep || "Working..."}</p>
              {progress.total > 0 && (
                <>
                  <p className="text-sm text-stone-500 mt-1">{progress.current} of {progress.total}</p>
                  <div className="h-2 bg-stone-100 dark:bg-stone-800 rounded-full overflow-hidden mt-3">
                    <div className="h-full bg-gradient-to-r from-indigo-500 to-violet-600 transition-all duration-500" style={{ width: `${(progress.current / progress.total) * 100}%` }} />
                  </div>
                </>
              )}
            </div>
          )}

          {phase === "done" && (
            <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl p-8 max-w-md mx-auto text-center">
              {error ? (
                <>
                  <div className="w-14 h-14 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mx-auto mb-3">
                    <span className="text-red-600 dark:text-red-400 text-2xl">!</span>
                  </div>
                  <p className="text-lg font-semibold text-red-700 dark:text-red-400">Import failed</p>
                  <p className="text-sm text-stone-500 mt-2">{error}</p>
                </>
              ) : (
                <>
                  <div className="w-14 h-14 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto mb-3">
                    <Check className="text-green-600 dark:text-green-400" size={28} strokeWidth={3} />
                  </div>
                  <p className="text-lg font-semibold text-stone-900 dark:text-stone-100">Product imported</p>
                  {translationStats && (
                    <p className="text-sm text-stone-500 mt-2">
                      Images translated: <strong>{translationStats.translated}/{translationStats.total}</strong>
                    </p>
                  )}
                  {adminUrl && (
                    <a href={adminUrl} target="_blank" rel="noopener" className="mt-4 inline-flex items-center gap-1.5 text-sm text-indigo-600 hover:underline">
                      Open in Shopify <LinkIcon size={13} />
                    </a>
                  )}
                </>
              )}
              <div className="mt-6">
                <button onClick={() => window.close()} className="text-sm text-stone-600 hover:text-stone-900 dark:hover:text-stone-100">Close tab</button>
              </div>
            </div>
          )}
        </div>
      </main>
    </>
  );
}

export default function ImportExternalPage() {
  return (
    <Suspense fallback={null}>
      <ImportExternalInner />
    </Suspense>
  );
}

const inputCls = "w-full px-3 py-2 border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition";

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer text-sm text-stone-700 dark:text-stone-300">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="rounded" />
      {label}
    </label>
  );
}
