"use client";

import { useEffect, useReducer, useState, useCallback, useRef, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import Header from "@/components/Header";
import type { ImportOptions } from "@/types/import";
import type { PreviewProduct, PreviewImage, PreviewState } from "@/components/preview/types";
import { previewReducer } from "@/components/preview/types";
import ProductCard from "@/components/preview/ProductCard";

type PagePhase = "loading" | "ready" | "importing" | "done";

const STORAGE_KEY = "shop-ai:preview";
const AI_COST_PER_IMAGE = 0.04;

function PreviewInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const store = searchParams.get("store") ?? "";

  const [state, dispatch] = useReducer(previewReducer, { products: [], aiCostUsed: 0 });
  const [phase, setPhase] = useState<PagePhase>("loading");
  const [loadProgress, setLoadProgress] = useState({ current: 0, total: 0 });
  const [loadStep, setLoadStep] = useState("Preparing...");
  const [opts, setOpts] = useState<ImportOptions | null>(null);

  // Regenerate tracking
  const [regeneratingImages, setRegeneratingImages] = useState<Set<string>>(new Set());

  // Import state
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0 });
  const [importStep, setImportStep] = useState("");
  const [importResults, setImportResults] = useState<{ handle: string; title: string; adminUrl?: string; success: boolean; error?: string }[]>([]);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [showConfirm, setShowConfirm] = useState(false);

  // Autosave with debounce
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if (phase !== "ready" || state.products.length === 0) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch { /* quota exceeded */ }
    }, 500);
    return () => clearTimeout(saveTimer.current);
  }, [state, phase]);

  // Load from completed job results
  async function loadFromJob(jobId: string) {
    setPhase("loading");
    setLoadStep("Loading job results...");
    try {
      const res = await fetch(`/api/jobs/${jobId}/results`);
      if (!res.ok) { setPhase("ready"); return; }
      const data = await res.json();

      if (data.options) {
        try { setOpts(JSON.parse(data.options)); } catch { /* ignore */ }
      }

      const products: PreviewProduct[] = (data.products ?? []).map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (raw: any) => {
          const images: PreviewImage[] = (raw.images ?? []).map(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (img: any, i: number) => ({
              id: `${raw.handle}-${i}-${Date.now()}`,
              role: img.role ?? "hero",
              originalUrl: img.originalUrl ?? "",
              resultBase64: img.resultBase64 ?? undefined,
              resultMime: img.resultMime ?? undefined,
              resultUrl: img.resultUrl ?? undefined,
              aiGenerated: img.aiGenerated ?? false,
              error: img.error ?? undefined,
              approved: !!(img.resultUrl || img.resultBase64),
              prompt: undefined,
              versions: [],
              currentVersion: 0,
            })
          );
          return {
            handle: raw.handle,
            title: raw.title,
            originalTitle: raw.title,
            description: raw.description,
            originalDescription: raw.description,
            vendor: raw.vendor ?? "",
            productType: raw.productType ?? "",
            price: raw.price ?? "29.95",
            images,
            included: true,
            collectionIds: [],
            tags: [],
          };
        }
      );

      const aiImages = products.reduce(
        (sum, p) => sum + p.images.filter((img) => img.aiGenerated).length,
        0
      );
      dispatch({ type: "SET_PRODUCTS", products });
      dispatch({ type: "ADD_AI_COST", cost: aiImages * AI_COST_PER_IMAGE });
    } catch { /* ignore */ }
    setPhase("ready");
  }

  // Load preview
  useEffect(() => {
    // Check if loading from a job
    const jobId = searchParams.get("jobId");
    if (jobId) {
      loadFromJob(jobId);
      return;
    }

    // Try to restore from sessionStorage first
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as PreviewState;
        if (parsed.products?.length > 0) {
          dispatch({ type: "RESTORE", state: parsed });
          setPhase("ready");
          // Also restore opts
          const rawOpts = sessionStorage.getItem("previewOptions");
          if (rawOpts) setOpts(JSON.parse(rawOpts));
          return;
        }
      }
    } catch { /* ignore */ }

    const rawOpts = sessionStorage.getItem("previewOptions");
    if (!rawOpts) { router.push("/scan"); return; }
    let parsedOpts: ImportOptions;
    try { parsedOpts = JSON.parse(rawOpts); } catch { router.push("/scan"); return; }
    setOpts(parsedOpts);
    runPreview(parsedOpts);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runPreview(importOpts: ImportOptions) {
    setPhase("loading");

    try {
      const res = await fetch("/api/import/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(importOpts),
      });

      if (!res.ok || !res.body) { setPhase("ready"); return; }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const products: PreviewProduct[] = [];
      let aiCost = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";

        for (const block of blocks) {
          const line = block.trim();
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === "product-start") {
              setLoadProgress(event.progress ?? { current: 0, total: 0 });
              setLoadStep(`Loading ${event.productHandle}...`);
            } else if (event.type === "step") {
              const labels: Record<string, string> = {
                fetching: "Fetching product data...",
                translating: "Translating...",
                "enhancing-title": "Enhancing title...",
                "enhancing-description": "Enhancing description...",
                "generating-images": "Generating AI images...",
              };
              setLoadStep(labels[event.step] ?? event.step ?? "");
            } else if (event.type === "product-preview") {
              const raw = event.product;
              const images: PreviewImage[] = (raw.images ?? []).map((img: Record<string, unknown>, i: number) => ({
                id: `${raw.handle}-${i}-${Date.now()}`,
                role: (img.role as string) ?? "hero",
                originalUrl: (img.originalUrl as string) ?? "",
                resultBase64: (img.resultBase64 as string) ?? undefined,
                resultMime: (img.resultMime as string) ?? undefined,
                aiGenerated: (img.aiGenerated as boolean) ?? false,
                error: (img.error as string) ?? undefined,
                approved: !!(img.resultBase64),
                prompt: undefined,
                versions: [],
                currentVersion: 0,
              }));
              const aiImages = images.filter((img) => img.aiGenerated).length;
              aiCost += aiImages * AI_COST_PER_IMAGE;

              products.push({
                handle: raw.handle,
                title: raw.title,
                originalTitle: raw.title,
                description: raw.description,
                originalDescription: raw.description,
                vendor: raw.vendor ?? "",
                productType: raw.productType ?? "",
                price: raw.price ?? "29.95",
                images,
                included: true,
                collectionIds: importOpts.collectionIds ?? [],
                tags: importOpts.tags ?? [],
              });
              dispatch({ type: "SET_PRODUCTS", products: [...products] });
            } else if (event.type === "complete") {
              // done
            }
          } catch { /* ignore */ }
        }
      }

      dispatch({ type: "ADD_AI_COST", cost: aiCost });
    } catch { /* ignore */ }
    setPhase("ready");
  }

  // Regenerate single image
  const handleRegenerate = useCallback(async (productIdx: number, imageIdx: number, prompt: string) => {
    const key = `${productIdx}:${imageIdx}`;
    setRegeneratingImages((prev) => new Set([...prev, key]));

    const product = state.products[productIdx];
    const image = product?.images[imageIdx];
    if (!product || !image) return;

    try {
      // Download original image to send to AI
      const imgRes = await fetch(image.originalUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
      if (!imgRes.ok) throw new Error("Download failed");
      const imgBuffer = await imgRes.arrayBuffer();
      const imgBase64 = Buffer.from(imgBuffer).toString("base64");
      const imgMime = imgRes.headers.get("content-type") || "image/png";

      // Use /api/scan/image-proxy to get base64, then /api/process to regenerate
      const processRes = await fetch("/api/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          presetId: opts?.aiImagePresetId ?? "audrey-roman",
          items: [{
            imageBase64: imgBase64,
            mimeType: imgMime,
            role: image.role,
            collection: opts?.aiImageCollection ?? "general",
            customPrompt: prompt,
          }],
        }),
      });

      if (!processRes.ok || !processRes.body) throw new Error("Process failed");

      // Read SSE
      const reader = processRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";
        for (const block of blocks) {
          const line = block.trim();
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.status === "done" && event.imageBase64) {
              dispatch({ type: "REPLACE_IMAGE", productIdx, imageIdx, base64: event.imageBase64, mime: event.mimeType ?? "image/png", prompt });
              dispatch({ type: "ADD_AI_COST", cost: AI_COST_PER_IMAGE });
            }
          } catch { /* ignore */ }
        }
      }
    } catch (err) {
      console.error("[preview] Regenerate failed:", err instanceof Error ? err.message : err);
    } finally {
      setRegeneratingImages((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }, [state.products, opts]);

  // Validation
  function validate(): string[] {
    const errors: string[] = [];
    const included = state.products.filter((p) => p.included);
    for (const p of included) {
      if (p.images.filter((img) => img.approved).length === 0)
        errors.push(`"${p.title}": no approved images`);
      if (!p.title.trim())
        errors.push(`Product "${p.handle}": title is empty`);
      if (!p.price || parseFloat(p.price) <= 0)
        errors.push(`"${p.title}": price is invalid`);
    }
    return errors;
  }

  function handleImportClick() {
    const errors = validate();
    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }
    setValidationErrors([]);
    setShowConfirm(true);
  }

  async function handleImport() {
    setShowConfirm(false);
    setPhase("importing");
    setImportResults([]);
    setImportStep("Starting...");

    if (!opts) return;

    const included = state.products.filter((p) => p.included);

    // Use the import/run endpoint
    const importOpts = {
      ...opts,
      selectedHandles: included.map((p) => p.handle),
    };

    try {
      const res = await fetch("/api/import/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(importOpts),
      });

      if (!res.ok || !res.body) { setPhase("done"); return; }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";

        for (const block of blocks) {
          const line = block.trim();
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === "product-start") {
              setImportProgress(event.progress ?? { current: 0, total: 0 });
            } else if (event.type === "step") {
              const labels: Record<string, string> = {
                fetching: "Fetching...", translating: "Translating...",
                "enhancing-title": "Enhancing title...", "enhancing-description": "Enhancing description...",
                "generating-images": "Generating images...", "downloading-images": "Downloading...",
                "creating-shopify": "Creating on Shopify...", "ai-image-failed": "AI image fallback...",
              };
              setImportStep(labels[event.step] ?? event.step ?? "");
            } else if (event.type === "product-done") {
              setImportResults((prev) => [...prev, { handle: event.productHandle, title: event.productTitle, adminUrl: event.result?.adminUrl, success: true }]);
            } else if (event.type === "product-error") {
              setImportResults((prev) => [...prev, { handle: event.productHandle, title: event.productHandle, success: false, error: event.error }]);
            } else if (event.type === "complete") {
              // done
            }
          } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }
    // Clear autosaved state
    sessionStorage.removeItem(STORAGE_KEY);
    setPhase("done");
  }

  // Stats
  const includedProducts = state.products.filter((p) => p.included);
  const totalApproved = includedProducts.reduce((sum, p) => sum + p.images.filter((img) => img.approved).length, 0);
  const totalImages = state.products.reduce((sum, p) => sum + p.images.length, 0);

  return (
    <div className="space-y-6 pb-24">
      {/* Desktop-only notice */}
      <div className="lg:hidden bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
        Best experience on desktop (1280px+).
      </div>

      {/* Loading phase */}
      {phase === "loading" && (
        <div className="bg-white border border-stone-200 rounded-xl p-10 text-center">
          <div className="w-10 h-10 border-4 border-stone-200 border-t-indigo-600 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm font-medium text-stone-700">
            Generating preview ({loadProgress.current}/{loadProgress.total})
          </p>
          <p className="text-xs text-stone-500 mt-1">{loadStep}</p>
          <div className="h-1.5 bg-stone-100 rounded-full overflow-hidden mt-4 max-w-sm mx-auto">
            <div
              className="h-full bg-indigo-600 rounded-full transition-all"
              style={{ width: `${loadProgress.total > 0 ? (loadProgress.current / loadProgress.total) * 100 : 0}%` }}
            />
          </div>

          {/* Show cards as they arrive */}
          {state.products.length > 0 && (
            <p className="text-xs text-stone-400 mt-4">
              {state.products.length} product{state.products.length !== 1 ? "s" : ""} loaded...
            </p>
          )}
        </div>
      )}

      {/* Ready / cards */}
      {(phase === "ready") && state.products.length > 0 && (
        <>
          {/* Summary bar */}
          <div className="bg-white border border-stone-200 rounded-xl px-5 py-3 flex items-center justify-between">
            <div className="flex items-center gap-4 text-sm text-stone-600">
              <span><strong className="text-stone-800">{includedProducts.length}</strong> product{includedProducts.length !== 1 ? "s" : ""}</span>
              <span className="text-stone-300">|</span>
              <span><strong className="text-stone-800">{totalImages}</strong> images</span>
              <span className="text-stone-300">|</span>
              <span><strong className="text-emerald-600">{totalApproved}</strong> approved</span>
              <span className="text-stone-300">|</span>
              <span className="text-xs text-stone-400">AI cost: ${state.aiCostUsed.toFixed(2)}</span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => dispatch({ type: "APPROVE_ALL" })}
                className="text-xs px-3 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded hover:bg-emerald-100"
              >
                Approve all
              </button>
            </div>
          </div>

          {/* Validation errors */}
          {validationErrors.length > 0 && (
            <div className="bg-rose-50 border border-rose-200 rounded-xl p-4">
              <p className="text-sm font-medium text-rose-800 mb-2">Cannot import:</p>
              <ul className="list-disc list-inside text-xs text-rose-700 space-y-1">
                {validationErrors.map((err, i) => <li key={i}>{err}</li>)}
              </ul>
            </div>
          )}

          {/* Product cards */}
          <div className="space-y-6">
            {state.products.map((product, pi) => (
              <ProductCard
                key={product.handle}
                product={product}
                productIdx={pi}
                dispatch={dispatch}
                onRegenerate={handleRegenerate}
                regeneratingImages={regeneratingImages}
                language={opts?.language ?? "en"}
              />
            ))}
          </div>
        </>
      )}

      {/* Importing phase */}
      {phase === "importing" && (
        <div className="bg-white border border-stone-200 rounded-xl p-10 text-center">
          <div className="w-10 h-10 border-4 border-stone-200 border-t-indigo-600 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm font-medium text-stone-700">
            Importing product {importProgress.current} of {importProgress.total}
          </p>
          <p className="text-xs text-stone-500 mt-1">{importStep}</p>
          {importResults.length > 0 && (
            <div className="mt-4 max-h-48 overflow-auto border border-stone-200 rounded-lg divide-y divide-stone-100 text-left max-w-md mx-auto">
              {importResults.map((r, i) => (
                <div key={i} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <span className={r.success ? "text-emerald-600" : "text-rose-500"}>{r.success ? "✓" : "✗"}</span>
                  <span className="flex-1 truncate">{r.title}</span>
                  {r.adminUrl && <a href={r.adminUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-600">View</a>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Done phase */}
      {phase === "done" && (
        <div className="bg-white border border-stone-200 rounded-xl p-10 text-center space-y-4">
          <div className="w-14 h-14 bg-emerald-100 rounded-full flex items-center justify-center mx-auto">
            <svg className="w-7 h-7 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-lg font-medium text-stone-800">
            {importResults.filter((r) => r.success).length} product{importResults.filter((r) => r.success).length !== 1 ? "s" : ""} imported
            {importResults.some((r) => !r.success) && (
              <span className="text-rose-600"> ({importResults.filter((r) => !r.success).length} failed)</span>
            )}
          </p>
          <div className="max-h-64 overflow-auto border border-stone-200 rounded-lg divide-y divide-stone-100 text-left max-w-lg mx-auto">
            {importResults.map((r, i) => (
              <div key={i} className="flex items-center gap-2 px-4 py-3 text-sm">
                <span className={r.success ? "text-emerald-600" : "text-rose-500"}>{r.success ? "✓" : "✗"}</span>
                <span className={`flex-1 truncate ${r.success ? "text-stone-800" : "text-rose-700"}`}>{r.title}</span>
                {r.adminUrl && (
                  <a href={r.adminUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-600 hover:text-indigo-800">
                    View on Shopify
                  </a>
                )}
                {r.error && <span className="text-[10px] text-rose-500 max-w-[180px] truncate">{r.error}</span>}
              </div>
            ))}
          </div>
          <div className="flex justify-center gap-3 pt-2">
            <Link href="/scan" className="text-sm border border-stone-300 text-stone-600 px-5 py-2.5 rounded-lg hover:border-stone-500">
              Import more
            </Link>
            <Link href="/library" className="text-sm bg-indigo-600 text-white px-5 py-2.5 rounded-lg hover:bg-indigo-700">
              Go to Library
            </Link>
          </div>
        </div>
      )}

      {/* Sticky footer */}
      {phase === "ready" && state.products.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur border-t border-stone-200 shadow-lg z-40">
          <div className="max-w-5xl mx-auto px-6 md:px-10 py-3 flex items-center justify-between">
            <div className="flex items-center gap-4 text-sm text-stone-600">
              <span>{includedProducts.length} product{includedProducts.length !== 1 ? "s" : ""} to create</span>
              <span className="text-stone-300">·</span>
              <span>{totalApproved} image{totalApproved !== 1 ? "s" : ""} to upload</span>
              <span className="text-stone-300">·</span>
              <span className="text-xs text-stone-400">AI cost used: ${state.aiCostUsed.toFixed(2)}</span>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => { sessionStorage.removeItem(STORAGE_KEY); router.push("/scan"); }}
                className="text-sm border border-stone-300 text-stone-600 px-4 py-2 rounded-lg hover:border-stone-500"
              >
                Cancel
              </button>
              <button
                onClick={handleImportClick}
                disabled={includedProducts.length === 0}
                className="text-sm bg-indigo-600 text-white px-6 py-2.5 rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50"
              >
                Import to Shopify
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm modal */}
      {showConfirm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowConfirm(false)}>
          <div className="bg-white rounded-xl max-w-md w-full p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-medium text-stone-800">Confirm import</h3>
            <p className="text-sm text-stone-600">
              Import <strong>{includedProducts.length}</strong> product{includedProducts.length !== 1 ? "s" : ""} with{" "}
              <strong>{totalApproved}</strong> image{totalApproved !== 1 ? "s" : ""} to Shopify as <strong>Draft</strong>?
            </p>
            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setShowConfirm(false)} className="text-sm text-stone-500 hover:text-stone-800 px-4 py-2">Cancel</button>
              <button onClick={handleImport} className="text-sm bg-indigo-600 text-white px-5 py-2.5 rounded-lg hover:bg-indigo-700 font-medium">
                Import
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function PreviewPage() {
  return (
    <>
    <Header />
    <main className="min-h-screen bg-stone-50 dark:bg-stone-950">
      <div className="max-w-5xl mx-auto p-6 md:p-10">
        <div className="mb-6">
          <Link href="/scan" className="text-sm text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200 mb-3 inline-block">← Back to scan</Link>
          <h1 className="text-2xl font-semibold text-stone-900 dark:text-stone-100">Preview Import</h1>
          <p className="text-sm text-stone-500 dark:text-stone-400 mt-1">Review, edit and approve before importing to Shopify.</p>
        </div>
        <Suspense fallback={<div className="text-center py-16 text-stone-500 text-sm">Loading...</div>}>
          <PreviewInner />
        </Suspense>
      </div>
    </main>
    </>
  );
}
