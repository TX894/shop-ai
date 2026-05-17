"use client";

import { useState, useEffect } from "react";
import type { ShopifyProduct } from "@/types/shopify";
import type { Preset } from "@/types/preset";
import type { ImportProductEvent } from "@/types/import";
import { Languages, ImagePlus, Tag, DollarSign, Send, Sparkles, X, Check, Loader2, ChevronRight, Search, Shield } from "lucide-react";

interface ImportModalProps {
  open: boolean;
  onClose: () => void;
  products: ShopifyProduct[];
  selectedHandles: Set<string>;
  sourceStore: string;
}

interface ShopifyCollection {
  id: string;
  title: string;
  handle: string;
  productsCount: number;
}

interface ImportResult {
  handle: string;
  title: string;
  adminUrl?: string;
  success: boolean;
  error?: string;
}

type Phase = "config" | "importing" | "done";
type TabId = "content" | "images" | "tags" | "pricing" | "publish";

type WatermarkPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center" | "bottom-strip";

const TABS: { id: TabId; label: string; icon: typeof Languages }[] = [
  { id: "content", label: "Content & SEO", icon: Languages },
  { id: "images", label: "Images & Brand", icon: ImagePlus },
  { id: "tags", label: "Tags & Collections", icon: Tag },
  { id: "pricing", label: "Pricing", icon: DollarSign },
  { id: "publish", label: "Publish", icon: Send },
];

const LANGUAGES = [
  { value: "pt", label: "Portuguese (PT)", flag: "🇵🇹" },
  { value: "en", label: "English", flag: "🇬🇧" },
  { value: "es", label: "Spanish", flag: "🇪🇸" },
  { value: "fr", label: "French", flag: "🇫🇷" },
  { value: "de", label: "German", flag: "🇩🇪" },
  { value: "it", label: "Italian", flag: "🇮🇹" },
];

export default function ImportModal({
  open,
  onClose,
  products,
  selectedHandles,
  sourceStore,
}: ImportModalProps) {
  // ── State: tabbed nav ─────────────────────────────────────────────
  const [tab, setTab] = useState<TabId>("content");

  // ── Options ───────────────────────────────────────────────────────
  const [language, setLanguage] = useState("pt");
  const [translateEnabled, setTranslateEnabled] = useState(true);
  // ON by default — image text translation is a key Shopify-policy safety layer
  const [translateImagesEnabled, setTranslateImagesEnabled] = useState(true);
  // nano-banana-edit is the most reliable for in-place text editing with a
  // short prompt. Nano Banana 2 silently no-ops on dense infographics.
  const [translateImagesModel, setTranslateImagesModel] = useState("nano-banana-edit");
  const [enhanceTitleEnabled, setEnhanceTitleEnabled] = useState(true);
  const [enhanceDescEnabled, setEnhanceDescEnabled] = useState(true);
  const [seoEnabled, setSeoEnabled] = useState(true);
  const [aiImagesEnabled, setAiImagesEnabled] = useState(false);
  // Default 10 — images are now processed in parallel server-side, so
  // 10 images take roughly the time of the slowest one (~60-90s) rather
  // than the sum (~600-900s sequential). Warning surfaces above 12.
  const [maxImages, setMaxImages] = useState(10);

  // Watermark / Shopify policy safety
  const [watermarkEnabled, setWatermarkEnabled] = useState(true);
  const [watermarkPosition, setWatermarkPosition] = useState<WatermarkPosition>("bottom-right");
  const [watermarkOpacity, setWatermarkOpacity] = useState(85);
  const [watermarkSize, setWatermarkSize] = useState(16);

  // Active store snapshot for the watermark preview
  const [activeStore, setActiveStore] = useState<{ id: string; name: string; logo_url: string | null; brand_short_name: string | null } | null>(null);

  // AI image settings
  const [presets, setPresets] = useState<Preset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [selectedCollection, setSelectedCollection] = useState("general");
  const [customPrompt, setCustomPrompt] = useState("");
  const [imageModels, setImageModels] = useState<{ slug: string; displayName: string; description: string; supportsEditing: boolean; creditsPerImage: number }[]>([]);
  const [selectedModel, setSelectedModel] = useState("nano-banana-edit");

  const [tags, setTags] = useState("closing-sale, imported");
  const [productSearch, setProductSearch] = useState("");

  // Collections
  const [collections, setCollections] = useState<ShopifyCollection[]>([]);
  const [selectedCollectionIds, setSelectedCollectionIds] = useState<Set<string>>(new Set());
  const [newCollectionName, setNewCollectionName] = useState("");
  const [creatingCollection, setCreatingCollection] = useState(false);

  // Pricing
  const [pricingMode, setPricingMode] = useState<"original" | "fixed" | "markup">("fixed");
  const [fixedPrice, setFixedPrice] = useState("29.95");
  const [markupPercent, setMarkupPercent] = useState("0");

  // Status + sales-channel publishing
  const [productStatus, setProductStatus] = useState<"DRAFT" | "ACTIVE">("DRAFT");
  const [publishMode, setPublishMode] = useState<"online-store" | "all" | "none">("online-store");

  // Product selection within modal
  const [modalSelected, setModalSelected] = useState<Set<string>>(new Set(selectedHandles));

  // Run state
  const [phase, setPhase] = useState<Phase>("config");
  const [currentStep, setCurrentStep] = useState("");
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [results, setResults] = useState<ImportResult[]>([]);
  const [summary, setSummary] = useState<{ total: number; success: number; failed: number } | null>(null);
  // Aggregate counters surfaced in the done screen
  const [translationStats, setTranslationStats] = useState<{ translated: number; unchanged: number; productCount: number } | null>(null);

  // ── Data loading ──────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    fetch("/api/presets").then((r) => r.json()).then((data: { presets: Preset[] }) => {
      setPresets(data.presets);
      if (data.presets[0]) {
        setSelectedPresetId(data.presets[0].id);
        const firstColl = Object.keys(data.presets[0].collection_presets)[0];
        if (firstColl) setSelectedCollection(firstColl);
      }
    }).catch(() => {});
    fetch("/api/shopify/collections").then((r) => r.json()).then((data: { collections?: ShopifyCollection[] }) => {
      setCollections(data.collections ?? []);
    }).catch(() => {});
    fetch("/api/models?editing=true").then((r) => r.json()).then((data: { models: typeof imageModels }) => {
      setImageModels(data.models);
    }).catch(() => {});
    fetch("/api/stores").then((r) => r.json()).then((d) => {
      const a = (d.stores ?? []).find((s: { is_active: boolean }) => s.is_active);
      if (a) setActiveStore({ id: a.id, name: a.name, logo_url: a.logo_url, brand_short_name: a.brand_short_name });
    }).catch(() => {});
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (open) {
      setModalSelected(new Set(selectedHandles));
      setPhase("config");
      setResults([]);
      setSummary(null);
      setTranslationStats(null);
      setTab("content");
    }
  }, [open, selectedHandles]);

  // ── Helpers ───────────────────────────────────────────────────────
  async function handleCreateCollection() {
    if (!newCollectionName.trim()) return;
    setCreatingCollection(true);
    try {
      const res = await fetch("/api/shopify/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newCollectionName.trim() }),
      });
      const data = await res.json();
      if (data.id) {
        setCollections((prev) => [...prev, { ...data, productsCount: 0 }]);
        setSelectedCollectionIds((prev) => new Set([...prev, data.id]));
        setNewCollectionName("");
      }
    } finally {
      setCreatingCollection(false);
    }
  }

  function toggleModalProduct(handle: string) {
    setModalSelected((prev) => {
      const next = new Set(prev);
      if (next.has(handle)) next.delete(handle);
      else next.add(handle);
      return next;
    });
  }

  // Cost
  const count = modalSelected.size;
  const modelCredits = imageModels.find((m) => m.slug === selectedModel)?.creditsPerImage ?? 4;
  const translateImagesCredits = imageModels.find((m) => m.slug === translateImagesModel)?.creditsPerImage ?? 8;
  const aiImageCost = aiImagesEnabled ? count * maxImages * modelCredits * 0.01 : 0;
  const translateImagesCost = translateImagesEnabled ? count * maxImages * translateImagesCredits * 0.01 : 0;
  const translateCost = translateEnabled ? count * 0.004 : 0;
  const enhanceCost = (enhanceTitleEnabled ? count * 0.002 : 0) + (enhanceDescEnabled ? count * 0.005 : 0);
  const seoCost = seoEnabled ? count * 0.003 : 0;
  const totalCost = aiImageCost + translateImagesCost + translateCost + enhanceCost + seoCost;

  function buildImportOptions(): Record<string, unknown> {
    return {
      sourceStore,
      language,
      translateEnabled,
      translateImagesEnabled,
      translateImagesModel: translateImagesEnabled ? translateImagesModel : undefined,
      enhanceTitleEnabled,
      enhanceDescriptionEnabled: enhanceDescEnabled,
      seoEnabled,
      aiImagesEnabled,
      aiImagePresetId: aiImagesEnabled ? selectedPresetId : undefined,
      aiImageCollection: aiImagesEnabled ? selectedCollection : undefined,
      aiImageCustomPrompt: aiImagesEnabled && customPrompt.trim() ? customPrompt.trim() : undefined,
      imageModel: aiImagesEnabled ? selectedModel : undefined,
      maxImages,
      watermarkEnabled,
      watermarkPosition,
      watermarkOpacity: watermarkOpacity / 100,
      watermarkSize: watermarkSize / 100,
      publishMode,
      tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      collectionIds: [...selectedCollectionIds],
      pricingMode,
      fixedPrice: pricingMode === "fixed" ? fixedPrice : undefined,
      markupPercent: pricingMode === "markup" ? parseFloat(markupPercent) || 0 : undefined,
      productStatus,
      selectedHandles: [...modalSelected],
    };
  }

  async function handleImport() {
    setPhase("importing");
    setResults([]);
    setSummary(null);
    setCurrentStep("Starting...");
    setProgress({ current: 0, total: count });

    try {
      const res = await fetch("/api/import/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildImportOptions()),
      });

      if (!res.ok || !res.body) {
        setPhase("done");
        setSummary({ total: count, success: 0, failed: count });
        return;
      }

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
            const event = JSON.parse(line.slice(6)) as ImportProductEvent;
            if (event.type === "product-start") {
              setProgress(event.progress ?? { current: 0, total: count });
              setCurrentStep(`Product ${event.progress?.current}/${event.progress?.total}: ${event.productHandle}`);
            } else if (event.type === "step") {
              const labels: Record<string, string> = {
                fetching: "Fetching product...",
                translating: "Translating text...",
                "translating-images": "Translating text inside images...",
                "watermarking": "Stamping brand watermark...",
                "watermark-failed": "Watermark failed (image saved without)",
                "image-done": "Image ready",
                "translate-image-unchanged": "An image came back unchanged from the model — falling back to original",
                "translation-summary": "Image translation summary",
                "translate-image-failed": "Image translation failed",
                "enhancing-title": "Polishing title...",
                "enhancing-description": "Writing description...",
                "seo-bundle": "Generating SEO meta...",
                "generating-images": "Generating AI images...",
                "downloading-images": "Downloading images...",
                "ai-image-failed": "AI image fell back to original",
                "creating-shopify": "Pushing to Shopify...",
              };
              setCurrentStep(labels[event.step ?? ""] ?? event.step ?? "");

              // Accumulate image-translation stats across all products
              if (event.step === "translation-summary" && event.progress) {
                const translated = event.progress.current;
                const total = event.progress.total;
                const unchanged = Math.max(0, total - translated);
                setTranslationStats((prev) => ({
                  translated: (prev?.translated ?? 0) + translated,
                  unchanged: (prev?.unchanged ?? 0) + unchanged,
                  productCount: (prev?.productCount ?? 0) + 1,
                }));
              }
            } else if (event.type === "product-done") {
              setResults((prev) => [...prev, { handle: event.productHandle ?? "", title: event.productTitle ?? "", adminUrl: event.result?.adminUrl, success: true }]);
            } else if (event.type === "product-error") {
              setResults((prev) => [...prev, { handle: event.productHandle ?? "", title: event.productHandle ?? "", success: false, error: event.error }]);
            } else if (event.type === "complete") {
              setSummary(event.summary ?? null);
            }
          } catch { /* ignore */ }
        }
      }
    } catch {
      setSummary({ total: count, success: results.filter((r) => r.success).length, failed: count - results.filter((r) => r.success).length });
    }
    setPhase("done");
  }

  if (!open) return null;

  // Filtered product list
  const filteredProducts = productSearch.trim()
    ? products.filter((p) => p.title.toLowerCase().includes(productSearch.toLowerCase().trim()))
    : products;

  const selectedPreset = presets.find((p) => p.id === selectedPresetId);
  const presetCollections = selectedPreset ? Object.keys(selectedPreset.collection_presets) : [];

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-start justify-center p-3 pt-4 overflow-auto">
      <div className="bg-white dark:bg-stone-900 rounded-2xl max-w-5xl w-full max-h-[95vh] overflow-hidden shadow-2xl border border-stone-200 dark:border-stone-800 flex flex-col">

        {/* HEADER */}
        <div className="px-6 py-4 border-b border-stone-200 dark:border-stone-800 flex items-center justify-between bg-gradient-to-r from-white to-stone-50 dark:from-stone-900 dark:to-stone-900/50">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white">
              <Sparkles size={16} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-stone-900 dark:text-stone-100">
                {phase === "config" ? "Import products" : phase === "importing" ? "Importing..." : "Import complete"}
              </h2>
              <p className="text-xs text-stone-500 mt-0.5">{count} product{count !== 1 ? "s" : ""} selected · from {sourceStore}</p>
            </div>
          </div>
          {phase !== "importing" && (
            <button onClick={onClose} className="p-2 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 rounded-lg"><X size={18} /></button>
          )}
        </div>

        {/* ─── CONFIG PHASE ─────────────────────────────────────────── */}
        {phase === "config" && (
          <div className="flex flex-1 min-h-0">
            {/* Sidebar tabs */}
            <aside className="w-56 border-r border-stone-200 dark:border-stone-800 p-3 bg-stone-50/50 dark:bg-stone-900/50 flex flex-col">
              {TABS.map((t) => {
                const Icon = t.icon;
                const isActive = tab === t.id;
                return (
                  <button key={t.id} onClick={() => setTab(t.id)} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all ${
                    isActive
                      ? "bg-stone-900 dark:bg-white text-white dark:text-stone-900 font-medium"
                      : "text-stone-600 dark:text-stone-400 hover:bg-white dark:hover:bg-stone-800"
                  }`}>
                    <Icon size={15} />
                    <span className="flex-1 text-left">{t.label}</span>
                    {isActive && <ChevronRight size={14} />}
                  </button>
                );
              })}

              {/* Cost summary */}
              <div className="mt-auto pt-4 border-t border-stone-200 dark:border-stone-800 mt-4">
                <p className="text-[10px] uppercase tracking-wider text-stone-500 font-medium mb-1.5">Estimated cost</p>
                <p className="text-2xl font-semibold text-stone-900 dark:text-stone-100">${totalCost.toFixed(2)}</p>
                <p className="text-[11px] text-stone-400 mt-1">for {count} product{count !== 1 ? "s" : ""}</p>
              </div>
            </aside>

            {/* Tab content */}
            <div className="flex-1 overflow-auto p-6 space-y-5">
              {tab === "content" && (
                <>
                  <SectionTitle title="Language" subtitle="Used for translation, title polish, description, and SEO meta." />
                  <div className="grid grid-cols-3 gap-2">
                    {LANGUAGES.map((l) => (
                      <button key={l.value} onClick={() => setLanguage(l.value)} className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition ${
                        language === l.value
                          ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 font-medium"
                          : "border-stone-200 dark:border-stone-700 hover:border-stone-300 dark:hover:border-stone-600"
                      }`}>
                        <span>{l.flag}</span>
                        <span>{l.label}</span>
                      </button>
                    ))}
                  </div>

                  <SectionTitle title="Text intelligence" subtitle="What the AI should do with the copy." />
                  <ToggleRow checked={translateEnabled} onChange={setTranslateEnabled}
                    title="Translate title & description" desc="Native rewrite into the chosen language, in brand voice." />
                  <ToggleRow checked={enhanceTitleEnabled} onChange={setEnhanceTitleEnabled}
                    title="Polish title for SEO" desc="50-70 char benefit-led title — no fluff, no hype." />
                  <ToggleRow checked={enhanceDescEnabled} onChange={setEnhanceDescEnabled}
                    title="Rewrite description" desc="Hook → body → benefit bullets → what's included → closer." />
                  <ToggleRow checked={seoEnabled} onChange={setSeoEnabled}
                    title="Generate SEO bundle" desc="Meta title (50-60 chars) + meta description + URL handle + tags + alt text." accent />
                </>
              )}

              {tab === "images" && (
                <>
                  {/* SHOPIFY POLICY BANNER */}
                  <div className="bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950/40 dark:to-teal-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl p-3 flex gap-3">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white flex-shrink-0">
                      <Shield size={14} />
                    </div>
                    <div className="text-xs text-stone-700 dark:text-stone-300 leading-relaxed">
                      <strong className="text-stone-900 dark:text-stone-100">Shopify policy safety:</strong> using competitor / supplier photography verbatim is a DMCA risk. Combine the three toggles below — watermark + image-text translation + AI restyle — to substantially transform each image and reduce takedown risk.
                    </div>
                  </div>

                  <SectionTitle title="Brand watermark" subtitle="Stamps your store logo (or brand name) onto every image. Critical compliance layer." />
                  {!activeStore?.logo_url && !activeStore?.brand_short_name ? (
                    <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3 text-xs text-amber-800 dark:text-amber-300">
                      No brand logo or short name yet for <strong>{activeStore?.name ?? "your store"}</strong>. Set them in <a href="/settings" className="underline font-medium">Settings → Brand Intelligence</a> before enabling the watermark.
                    </div>
                  ) : (
                    <ToggleRow checked={watermarkEnabled} onChange={setWatermarkEnabled}
                      title={`Stamp ${activeStore?.logo_url ? activeStore.name + " logo" : "“" + (activeStore?.brand_short_name ?? activeStore?.name) + "” text"} on every image`}
                      desc="Applied LAST in the pipeline so it survives AI restyle + image translation." accent />
                  )}
                  {watermarkEnabled && (activeStore?.logo_url || activeStore?.brand_short_name) && (
                    <div className="ml-9 -mt-2 space-y-3">
                      <div>
                        <Label>Position</Label>
                        <div className="grid grid-cols-3 gap-1.5">
                          {([
                            ["top-left", "Top L"],
                            ["top-right", "Top R"],
                            ["center", "Center"],
                            ["bottom-left", "Bot L"],
                            ["bottom-right", "Bot R"],
                            ["bottom-strip", "Strip"],
                          ] as const).map(([pos, label]) => (
                            <button key={pos} onClick={() => setWatermarkPosition(pos as WatermarkPosition)} className={`text-xs py-1.5 px-2 rounded-lg border transition ${watermarkPosition === pos ? "border-violet-500 bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 font-medium" : "border-stone-200 dark:border-stone-700 text-stone-600 hover:border-stone-300"}`}>{label}</button>
                          ))}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label>Opacity: {watermarkOpacity}%</Label>
                          <input type="range" min={20} max={100} value={watermarkOpacity} onChange={(e) => setWatermarkOpacity(parseInt(e.target.value, 10))} className="w-full" />
                        </div>
                        <div>
                          <Label>Size: {watermarkSize}% of width</Label>
                          <input type="range" min={5} max={40} value={watermarkSize} onChange={(e) => setWatermarkSize(parseInt(e.target.value, 10))} className="w-full" />
                        </div>
                      </div>
                    </div>
                  )}

                  <SectionTitle title="How many source images" subtitle="From the source product. Shopify accepts up to 250 per product." />
                  <div className="flex items-center gap-3">
                    <input type="range" min={1} max={30} value={maxImages} onChange={(e) => setMaxImages(parseInt(e.target.value, 10))} className="flex-1" />
                    <span className="text-sm font-medium text-stone-900 dark:text-stone-100 w-12 text-right">{maxImages}</span>
                  </div>
                  {translateImagesEnabled && maxImages > 12 && (
                    <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-2.5 text-xs text-amber-800 dark:text-amber-300 -mt-1">
                      <strong>⚠️ At higher counts the 300 s Vercel budget can still be hit</strong> if a single image fights the model. Images are processed in parallel server-side, so 10 is the comfortable sweet spot. Bump only if you need every supplier photo.
                    </div>
                  )}
                  {(!translateImagesEnabled || maxImages <= 12) && (
                    <p className="text-xs text-stone-400 -mt-1">Processed in parallel server-side — 10 is the sweet spot with image translation on.</p>
                  )}

                  <SectionTitle title="Translate text inside images" subtitle="Re-render any visible word — including phone-screen mockups — into the chosen language." />
                  <ToggleRow checked={translateImagesEnabled} onChange={setTranslateImagesEnabled}
                    title="Translate image text" desc="Each image goes through an editor model that rewrites visible words." />
                  {translateImagesEnabled && (
                    <div className="ml-9 -mt-2">
                      <Label>Translator model</Label>
                      <select value={translateImagesModel} onChange={(e) => setTranslateImagesModel(e.target.value)} className={inputCls}>
                        {imageModels.map((m) => <option key={m.slug} value={m.slug}>{m.displayName} ({m.creditsPerImage} credits)</option>)}
                      </select>
                      <p className="text-[11px] text-stone-400 mt-1.5 leading-snug">
                        <strong>Nano Banana Edit</strong> is the default — fastest, cheapest (4 credits), most reliable for in-place text rewriting. Try Nano Banana 2 or Flux Kontext Max only if Edit misses on specific images.
                        For stubborn images (brand text engraved on the product, curved 3D wordmarks, infographic badges), switch to <strong>Flux Kontext Max</strong> (20 credits) — slower and pricier but the strongest at editing text on real product surfaces.
                      </p>
                    </div>
                  )}

                  <SectionTitle title="AI restyle" subtitle="Apply your brand aesthetic on top of each image." />
                  <ToggleRow checked={aiImagesEnabled} onChange={setAiImagesEnabled}
                    title="Generate AI images" desc="Restyle product photos with the selected brand preset." />
                  {aiImagesEnabled && (
                    <div className="ml-9 -mt-2 space-y-3">
                      <div>
                        <Label>Image model</Label>
                        <select value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)} className={inputCls}>
                          {imageModels.map((m) => <option key={m.slug} value={m.slug}>{m.displayName} ({m.creditsPerImage} credits)</option>)}
                        </select>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label>Brand preset</Label>
                          <select value={selectedPresetId} onChange={(e) => { setSelectedPresetId(e.target.value); const p = presets.find((x) => x.id === e.target.value); if (p) setSelectedCollection(Object.keys(p.collection_presets)[0] || "general"); }} className={inputCls}>
                            {presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                          </select>
                        </div>
                        <div>
                          <Label>Collection style</Label>
                          <select value={selectedCollection} onChange={(e) => setSelectedCollection(e.target.value)} className={inputCls}>
                            {presetCollections.map((c) => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </div>
                      </div>
                      <div>
                        <Label>Additional prompt (optional)</Label>
                        <textarea value={customPrompt} onChange={(e) => setCustomPrompt(e.target.value)} rows={2} placeholder="e.g. marble surface, soft golden hour light" className={inputCls + " resize-y"} />
                      </div>
                    </div>
                  )}
                </>
              )}

              {tab === "tags" && (
                <>
                  <SectionTitle title="Auto-add tags" subtitle="Comma-separated. Applied to every imported product. SEO tags from the AI bundle are merged automatically." />
                  <input type="text" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="closing-sale, imported, summer-2026" className={inputCls} />

                  <SectionTitle title="Add to collections" subtitle="Select existing collections to add products to." />
                  {collections.length === 0 ? (
                    <p className="text-xs text-stone-400 italic">No collections found. Create one below.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {collections.map((c) => {
                        const isSel = selectedCollectionIds.has(c.id);
                        return (
                          <button key={c.id} onClick={() => setSelectedCollectionIds((prev) => { const n = new Set(prev); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })}
                            className={`text-xs px-2.5 py-1 rounded-full border transition ${
                              isSel ? "bg-indigo-50 dark:bg-indigo-900/40 border-indigo-300 dark:border-indigo-600 text-indigo-700 dark:text-indigo-300 font-medium" : "border-stone-200 dark:border-stone-700 text-stone-600 dark:text-stone-400 hover:border-stone-400"
                            }`}>{c.title} {isSel && "✓"}</button>
                        );
                      })}
                    </div>
                  )}
                  <div className="flex gap-2 mt-2">
                    <input type="text" value={newCollectionName} onChange={(e) => setNewCollectionName(e.target.value)} placeholder="New collection name" className={inputCls + " flex-1"} />
                    <button onClick={handleCreateCollection} disabled={creatingCollection || !newCollectionName.trim()} className="px-3 py-2 text-xs bg-stone-900 dark:bg-stone-100 dark:text-stone-900 text-white rounded-lg disabled:opacity-50 whitespace-nowrap">{creatingCollection ? "..." : "Create"}</button>
                  </div>
                </>
              )}

              {tab === "pricing" && (
                <>
                  <SectionTitle title="Pricing strategy" subtitle="How the price for each Shopify product is computed." />
                  <div className="space-y-2">
                    {([["original", "Original price", "Use whatever the source store had."],
                       ["fixed", "Fixed price", "Same price for every imported product."],
                       ["markup", "Original + markup", "Apply a % markup on the original price."]] as const).map(([mode, label, hint]) => (
                      <label key={mode} className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition ${pricingMode === mode ? "border-indigo-500 bg-indigo-50/40 dark:bg-indigo-900/20" : "border-stone-200 dark:border-stone-700 hover:border-stone-300"}`}>
                        <input type="radio" name="pricing" checked={pricingMode === mode} onChange={() => setPricingMode(mode)} className="mt-0.5" />
                        <div>
                          <p className="text-sm font-medium text-stone-900 dark:text-stone-100">{label}</p>
                          <p className="text-xs text-stone-500">{hint}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                  {pricingMode === "fixed" && (
                    <div className="flex items-center gap-2">
                      <span className="text-lg text-stone-500">£</span>
                      <input type="text" value={fixedPrice} onChange={(e) => setFixedPrice(e.target.value)} className={inputCls + " w-32 text-lg font-medium"} />
                    </div>
                  )}
                  {pricingMode === "markup" && (
                    <div className="flex items-center gap-2">
                      <input type="text" value={markupPercent} onChange={(e) => setMarkupPercent(e.target.value)} className={inputCls + " w-24 text-lg font-medium"} />
                      <span className="text-lg text-stone-500">% markup</span>
                    </div>
                  )}
                </>
              )}

              {tab === "publish" && (
                <>
                  <SectionTitle title="Product status on Shopify" subtitle="DRAFT products are invisible to shoppers — recommended for first import so you can review before going live." />
                  <div className="grid grid-cols-2 gap-3">
                    {(["DRAFT", "ACTIVE"] as const).map((s) => (
                      <button key={s} onClick={() => setProductStatus(s)} className={`px-4 py-3 rounded-xl border text-sm font-medium transition ${
                        productStatus === s
                          ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300"
                          : "border-stone-200 dark:border-stone-700 text-stone-700 dark:text-stone-300 hover:border-stone-300"
                      }`}>
                        {s === "DRAFT" ? "📝 Draft" : "🟢 Active"}
                        <p className="text-[11px] text-stone-500 font-normal mt-1">{s === "DRAFT" ? "Stage for review" : "Live immediately"}</p>
                      </button>
                    ))}
                  </div>

                  <SectionTitle title="Sales channels" subtitle="Where the product becomes visible. Without publishing, the storefront returns 404 even when status is Active." />
                  <div className="space-y-2">
                    {([
                      ["online-store", "Online Store", "Publish to the storefront — required for customers to see / buy."],
                      ["all", "All sales channels", "Online Store + every other channel the app can access (POS, Google Shopping, Meta, etc.)."],
                      ["none", "Admin only (do not publish)", "Product stays invisible everywhere. Use only if you want to publish manually later."],
                    ] as const).map(([mode, label, hint]) => (
                      <label key={mode} className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition ${publishMode === mode ? "border-indigo-500 bg-indigo-50/40 dark:bg-indigo-900/20" : "border-stone-200 dark:border-stone-700 hover:border-stone-300"}`}>
                        <input type="radio" name="publishMode" checked={publishMode === mode} onChange={() => setPublishMode(mode)} className="mt-0.5" />
                        <div>
                          <p className="text-sm font-medium text-stone-900 dark:text-stone-100">{label}</p>
                          <p className="text-xs text-stone-500">{hint}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                  {publishMode === "none" && (
                    <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3 text-xs text-amber-800 dark:text-amber-300">
                      ⚠️ With this option you will get the same 404 issue you saw before — the product exists in admin but no channel sees it. Pick &quot;Online Store&quot; unless you have a reason.
                    </div>
                  )}

                  <SectionTitle title="Products to import" subtitle={`${modalSelected.size} of ${products.length} selected`} />
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
                    <input type="text" value={productSearch} onChange={(e) => setProductSearch(e.target.value)} placeholder="Search by name..." className={inputCls + " pl-9"} />
                  </div>
                  <div className="flex items-center justify-between -mb-1">
                    <button onClick={() => { if (modalSelected.size === products.length) setModalSelected(new Set()); else setModalSelected(new Set(products.map((p) => p.handle))); }} className="text-xs text-indigo-600 hover:text-indigo-800 underline">
                      {modalSelected.size === products.length ? "Deselect all" : "Select all"}
                    </button>
                  </div>
                  <div className="max-h-56 overflow-auto border border-stone-200 dark:border-stone-800 rounded-xl divide-y divide-stone-100 dark:divide-stone-800">
                    {filteredProducts.map((p) => {
                      const isSel = modalSelected.has(p.handle);
                      const img = p.images[0]?.src;
                      const price = p.variants[0]?.price;
                      return (
                        <div key={p.handle} onClick={() => toggleModalProduct(p.handle)} className={`flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-stone-50 dark:hover:bg-stone-800/50 ${isSel ? "bg-indigo-50/50 dark:bg-indigo-900/20" : ""}`}>
                          <div className={`w-4 h-4 rounded border-2 flex-shrink-0 flex items-center justify-center ${isSel ? "bg-indigo-600 border-indigo-600" : "border-stone-300 dark:border-stone-600"}`}>
                            {isSel && <Check className="text-white" size={10} strokeWidth={4} />}
                          </div>
                          {img && <img src={img} alt="" className="w-8 h-8 object-cover rounded" />}
                          <span className="text-sm text-stone-800 dark:text-stone-200 flex-1 truncate">{p.title}</span>
                          {price && <span className="text-xs text-stone-500">£{parseFloat(price).toFixed(2)}</span>}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* ─── IMPORTING PHASE ──────────────────────────────────────── */}
        {phase === "importing" && (
          <div className="p-8 space-y-5">
            <div className="text-center">
              <div className="w-12 h-12 rounded-full bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center mx-auto mb-3">
                <Loader2 className="text-indigo-600 animate-spin" size={24} />
              </div>
              <p className="text-base font-medium text-stone-900 dark:text-stone-100">Importing product {progress.current} of {progress.total}</p>
              <p className="text-sm text-stone-500 mt-1">{currentStep}</p>
            </div>
            <div className="h-2 bg-stone-100 dark:bg-stone-800 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-indigo-500 to-violet-600 transition-all duration-500" style={{ width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%` }} />
            </div>
            {results.length > 0 && (
              <div className="max-h-48 overflow-auto border border-stone-200 dark:border-stone-800 rounded-xl divide-y divide-stone-100 dark:divide-stone-800">
                {results.map((r, i) => (
                  <div key={i} className="flex items-center gap-2 px-3 py-2 text-sm">
                    <span className={r.success ? "text-green-600" : "text-red-500"}>{r.success ? "✓" : "✗"}</span>
                    <span className={`flex-1 truncate ${r.success ? "text-stone-800 dark:text-stone-200" : "text-red-700 dark:text-red-400"}`}>{r.title || r.handle}</span>
                    {r.success && r.adminUrl && <a href={r.adminUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-600 hover:text-indigo-800">View</a>}
                    {!r.success && r.error && <span className="text-[10px] text-red-500 max-w-[200px] truncate">{r.error}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ─── DONE PHASE — timeout fallback (no summary received) ──── */}
        {phase === "done" && !summary && (
          <div className="p-8 space-y-4">
            <div className="text-center">
              <div className="w-14 h-14 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mx-auto mb-3">
                <span className="text-red-600 dark:text-red-400 text-2xl">⏱</span>
              </div>
              <p className="text-base font-semibold text-stone-900 dark:text-stone-100">Import ran out of time</p>
              <p className="text-sm text-stone-500 mt-2 leading-relaxed max-w-md mx-auto">
                Vercel killed the function before it finished. This usually happens when image translation is on and there are too many source images.
                <br /><br />
                <strong>Likely:</strong> no product was created in Shopify. Reduce <strong>maxImages</strong> to 5 or fewer, or disable image translation, and retry.
              </p>
              {results.length > 0 && (
                <p className="text-xs text-stone-400 mt-3">{results.length} step(s) completed before timeout.</p>
              )}
            </div>
            <div className="flex justify-center pt-2 gap-2">
              <button onClick={() => { setPhase("config"); setResults([]); setMaxImages(Math.min(maxImages, 5)); }} className="px-5 py-2 border border-stone-300 dark:border-stone-700 text-stone-700 dark:text-stone-300 rounded-lg text-sm font-medium hover:bg-stone-50 dark:hover:bg-stone-800">
                Retry with fewer images
              </button>
              <button onClick={onClose} className="px-5 py-2 bg-stone-900 dark:bg-white dark:text-stone-900 text-white rounded-lg text-sm font-medium">Close</button>
            </div>
          </div>
        )}

        {/* ─── DONE PHASE ───────────────────────────────────────────── */}
        {phase === "done" && summary && (
          <div className="p-8 space-y-4">
            <div className="text-center">
              <div className={`w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3 ${summary.failed === 0 ? "bg-green-100 dark:bg-green-900/30" : "bg-amber-100 dark:bg-amber-900/30"}`}>
                {summary.failed === 0 ? <Check className="text-green-600 dark:text-green-400" size={28} strokeWidth={3} /> : <span className="text-amber-600 text-2xl">!</span>}
              </div>
              <p className="text-lg font-semibold text-stone-900 dark:text-stone-100">{summary.success} product{summary.success !== 1 ? "s" : ""} imported{summary.failed > 0 && `, ${summary.failed} failed`}</p>
              {translationStats && (translationStats.translated + translationStats.unchanged) > 0 && (
                <div className="mt-3 inline-flex flex-col items-start gap-1 text-left text-xs bg-stone-50 dark:bg-stone-800/50 border border-stone-200 dark:border-stone-700 rounded-lg px-3 py-2">
                  <div className="font-medium text-stone-700 dark:text-stone-300">Image translation</div>
                  <div className="text-stone-600 dark:text-stone-400">
                    ✓ <strong>{translationStats.translated}</strong> images translated
                  </div>
                  {translationStats.unchanged > 0 && (
                    <div className="text-amber-700 dark:text-amber-400">
                      ⚠ <strong>{translationStats.unchanged}</strong> image{translationStats.unchanged !== 1 ? "s" : ""} came back unchanged (the model couldn&apos;t edit them — open the product in Shopify and replace manually, or retry the import)
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="max-h-72 overflow-auto border border-stone-200 dark:border-stone-800 rounded-xl divide-y divide-stone-100 dark:divide-stone-800">
              {results.map((r, i) => (
                <div key={i} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <span className={r.success ? "text-green-600" : "text-red-500"}>{r.success ? "✓" : "✗"}</span>
                  <span className={`flex-1 truncate ${r.success ? "text-stone-800 dark:text-stone-200" : "text-red-700 dark:text-red-400"}`}>{r.title || r.handle}</span>
                  {r.success && r.adminUrl && <a href={r.adminUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-600 hover:text-indigo-800">View on Shopify</a>}
                  {!r.success && <span className="text-[10px] text-red-500 max-w-[200px] truncate">{r.error}</span>}
                </div>
              ))}
            </div>
            <div className="flex justify-center pt-2">
              <button onClick={onClose} className="px-6 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700">Done</button>
            </div>
          </div>
        )}

        {/* FOOTER (config phase only) */}
        {phase === "config" && (
          <div className="border-t border-stone-200 dark:border-stone-800 p-4 flex items-center justify-between bg-white dark:bg-stone-900">
            <button onClick={onClose} className="text-sm text-stone-500 hover:text-stone-900 dark:text-stone-400 px-3 py-2">Cancel</button>
            <div className="flex gap-2">
              <button onClick={() => {
                sessionStorage.setItem("previewOptions", JSON.stringify(buildImportOptions()));
                window.location.href = `/scan/preview?store=${sourceStore}`;
              }} disabled={modalSelected.size === 0} className="text-sm border border-stone-300 dark:border-stone-700 text-stone-700 dark:text-stone-300 px-4 py-2.5 rounded-lg hover:border-stone-500 disabled:opacity-50">
                Preview first
              </button>
              <button onClick={handleImport} disabled={modalSelected.size === 0} className="text-sm bg-gradient-to-br from-indigo-600 to-violet-600 text-white px-6 py-2.5 rounded-lg hover:from-indigo-700 hover:to-violet-700 disabled:opacity-50 font-medium shadow-sm inline-flex items-center gap-2">
                <Sparkles size={14} />
                Import {modalSelected.size} product{modalSelected.size !== 1 ? "s" : ""}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Atoms
// ──────────────────────────────────────────────────────────────────────

const inputCls = "w-full px-3 py-2 border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition";

function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="pt-3 first:pt-0">
      <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">{title}</h3>
      {subtitle && <p className="text-xs text-stone-500 mt-0.5">{subtitle}</p>}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-xs font-medium text-stone-700 dark:text-stone-300 mb-1.5">{children}</label>;
}

function ToggleRow({ checked, onChange, title, desc, accent }: { checked: boolean; onChange: (v: boolean) => void; title: string; desc: string; accent?: boolean }) {
  return (
    <button onClick={() => onChange(!checked)} className={`w-full flex items-start gap-3 p-3 rounded-xl border text-left transition ${
      checked
        ? accent ? "border-violet-400 bg-violet-50 dark:bg-violet-900/20" : "border-indigo-400 bg-indigo-50/60 dark:bg-indigo-900/20"
        : "border-stone-200 dark:border-stone-700 hover:border-stone-300 dark:hover:border-stone-600"
    }`}>
      <div className={`w-5 h-5 rounded-md border-2 flex-shrink-0 flex items-center justify-center mt-0.5 ${
        checked
          ? accent ? "bg-violet-600 border-violet-600" : "bg-indigo-600 border-indigo-600"
          : "border-stone-300 dark:border-stone-600"
      }`}>
        {checked && <Check className="text-white" size={12} strokeWidth={4} />}
      </div>
      <div className="flex-1">
        <p className="text-sm font-medium text-stone-900 dark:text-stone-100">{title}</p>
        <p className="text-xs text-stone-500 mt-0.5 leading-relaxed">{desc}</p>
      </div>
    </button>
  );
}
