"use client";

import { useState, useEffect } from "react";
import type { ShopifyProduct } from "@/types/shopify";
import type { Preset } from "@/types/preset";
import type { ImportProductEvent } from "@/types/import";

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

export default function ImportModal({
  open,
  onClose,
  products,
  selectedHandles,
  sourceStore,
}: ImportModalProps) {
  // Options state
  const [language, setLanguage] = useState("pt");
  const [translateEnabled, setTranslateEnabled] = useState(true);
  const [enhanceTitleEnabled, setEnhanceTitleEnabled] = useState(false);
  const [enhanceDescEnabled, setEnhanceDescEnabled] = useState(false);
  const [aiImagesEnabled, setAiImagesEnabled] = useState(true);
  const [showOptions, setShowOptions] = useState(false);

  // AI image settings
  const [presets, setPresets] = useState<Preset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [selectedCollection, setSelectedCollection] = useState("general");
  const [customPrompt, setCustomPrompt] = useState("");
  const [imageModels, setImageModels] = useState<{ slug: string; displayName: string; description: string; supportsEditing: boolean; creditsPerImage: number }[]>([]);
  const [selectedModel, setSelectedModel] = useState("nano-banana-edit");

  // Tags
  const [tags, setTags] = useState("closing-sale, imported");

  // Collections
  const [collections, setCollections] = useState<ShopifyCollection[]>([]);
  const [selectedCollectionIds, setSelectedCollectionIds] = useState<Set<string>>(new Set());
  const [newCollectionName, setNewCollectionName] = useState("");
  const [creatingCollection, setCreatingCollection] = useState(false);

  // Pricing
  const [pricingMode, setPricingMode] = useState<"original" | "fixed" | "markup">("fixed");
  const [fixedPrice, setFixedPrice] = useState("29.95");
  const [markupPercent, setMarkupPercent] = useState("0");

  // Status
  const [productStatus, setProductStatus] = useState<"DRAFT" | "ACTIVE">("DRAFT");

  // Product selection within modal
  const [modalSelected, setModalSelected] = useState<Set<string>>(new Set(selectedHandles));

  // Import state
  const [phase, setPhase] = useState<Phase>("config");
  const [currentStep, setCurrentStep] = useState("");
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [results, setResults] = useState<ImportResult[]>([]);
  const [summary, setSummary] = useState<{ total: number; success: number; failed: number } | null>(null);

  // Load presets and collections
  useEffect(() => {
    if (!open) return;
    fetch("/api/presets")
      .then((r) => r.json())
      .then((data: { presets: Preset[] }) => {
        setPresets(data.presets);
        if (data.presets[0]) {
          setSelectedPresetId(data.presets[0].id);
          const firstColl = Object.keys(data.presets[0].collection_presets)[0];
          if (firstColl) setSelectedCollection(firstColl);
        }
      })
      .catch(() => {});

    fetch("/api/shopify/collections")
      .then((r) => r.json())
      .then((data: { collections?: ShopifyCollection[] }) => {
        setCollections(data.collections ?? []);
      })
      .catch(() => {});

    fetch("/api/models?editing=true")
      .then((r) => r.json())
      .then((data: { models: typeof imageModels }) => {
        setImageModels(data.models);
      })
      .catch(() => {});
  }, [open]);

  // Reset when opened
  useEffect(() => {
    if (open) {
      setModalSelected(new Set(selectedHandles));
      setPhase("config");
      setResults([]);
      setSummary(null);
    }
  }, [open, selectedHandles]);

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

  // Cost estimate
  const count = modalSelected.size;
  const avgImages = 3;
  const modelCredits = imageModels.find((m) => m.slug === selectedModel)?.creditsPerImage ?? 4;
  const aiImageCost = aiImagesEnabled ? count * avgImages * modelCredits * 0.01 : 0;
  const translateCost = translateEnabled ? count * 0.004 : 0;
  const enhanceCost = (enhanceTitleEnabled ? count * 0.002 : 0) + (enhanceDescEnabled ? count * 0.003 : 0);
  const totalCost = aiImageCost + translateCost + enhanceCost;

  async function handleImport() {
    setPhase("importing");
    setResults([]);
    setSummary(null);
    setCurrentStep("A iniciar...");
    setProgress({ current: 0, total: count });

    try {
      const res = await fetch("/api/import/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceStore,
          language,
          translateEnabled,
          enhanceTitleEnabled,
          enhanceDescriptionEnabled: enhanceDescEnabled,
          aiImagesEnabled,
          aiImagePresetId: aiImagesEnabled ? selectedPresetId : undefined,
          aiImageCollection: aiImagesEnabled ? selectedCollection : undefined,
          aiImageCustomPrompt: aiImagesEnabled && customPrompt.trim() ? customPrompt.trim() : undefined,
          imageModel: aiImagesEnabled ? selectedModel : undefined,
          tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
          collectionIds: [...selectedCollectionIds],
          pricingMode,
          fixedPrice: pricingMode === "fixed" ? fixedPrice : undefined,
          markupPercent: pricingMode === "markup" ? parseFloat(markupPercent) || 0 : undefined,
          productStatus,
          selectedHandles: [...modalSelected],
        }),
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
              setCurrentStep(`Produto ${event.progress?.current}/${event.progress?.total}: ${event.productHandle}`);
            } else if (event.type === "step") {
              const stepLabels: Record<string, string> = {
                fetching: "A buscar dados...",
                translating: "A traduzir...",
                "enhancing-title": "A melhorar título...",
                "enhancing-description": "A melhorar descrição...",
                "generating-images": "A gerar imagens AI...",
                "downloading-images": "A descarregar imagens...",
                "creating-shopify": "A criar no Shopify...",
              };
              setCurrentStep(stepLabels[event.step ?? ""] ?? event.step ?? "");
            } else if (event.type === "product-done") {
              setResults((prev) => [
                ...prev,
                {
                  handle: event.productHandle ?? "",
                  title: event.productTitle ?? "",
                  adminUrl: event.result?.adminUrl,
                  success: true,
                },
              ]);
            } else if (event.type === "product-error") {
              setResults((prev) => [
                ...prev,
                {
                  handle: event.productHandle ?? "",
                  title: event.productHandle ?? "",
                  success: false,
                  error: event.error,
                },
              ]);
            } else if (event.type === "complete") {
              setSummary(event.summary ?? null);
            }
          } catch { /* ignore */ }
        }
      }
    } catch (err) {
      setSummary({
        total: count,
        success: results.filter((r) => r.success).length,
        failed: count - results.filter((r) => r.success).length,
      });
    }
    setPhase("done");
  }

  if (!open) return null;

  const selectedPreset = presets.find((p) => p.id === selectedPresetId);
  const presetCollections = selectedPreset
    ? Object.keys(selectedPreset.collection_presets)
    : [];

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-start justify-center p-4 pt-8 overflow-auto">
      <div className="bg-white rounded-lg max-w-3xl w-full max-h-[90vh] overflow-auto shadow-xl">
        {/* Header */}
        <div className="sticky top-0 bg-white z-10 px-6 py-4 border-b border-stone-200 flex items-center justify-between">
          <h2 className="text-lg font-medium text-stone-800">
            {phase === "config"
              ? "Import products"
              : phase === "importing"
              ? "Importing..."
              : "Import complete"}
          </h2>
          {phase !== "importing" && (
            <button onClick={onClose} className="text-stone-400 hover:text-stone-800 text-xl leading-none">&times;</button>
          )}
        </div>

        {/* PHASE: Config */}
        {phase === "config" && (
          <div className="p-6 space-y-6">
            {/* Top controls row */}
            <div className="flex flex-wrap items-center gap-4">
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1">Language</label>
                <select value={language} onChange={(e) => setLanguage(e.target.value)} className="px-3 py-1.5 border border-stone-300 rounded text-sm bg-white">
                  <option value="pt">Portuguese (PT)</option>
                  <option value="en">English</option>
                  <option value="es">Spanish</option>
                  <option value="fr">French</option>
                  <option value="de">German</option>
                  <option value="it">Italian</option>
                </select>
              </div>

              <label className="flex items-center gap-2 text-sm text-stone-700 cursor-pointer">
                <input type="checkbox" checked={translateEnabled} onChange={(e) => setTranslateEnabled(e.target.checked)} className="rounded" />
                Translate
              </label>
              <label className="flex items-center gap-2 text-sm text-stone-700 cursor-pointer">
                <input type="checkbox" checked={enhanceTitleEnabled} onChange={(e) => setEnhanceTitleEnabled(e.target.checked)} className="rounded" />
                Enhance Title
              </label>
              <label className="flex items-center gap-2 text-sm text-stone-700 cursor-pointer">
                <input type="checkbox" checked={enhanceDescEnabled} onChange={(e) => setEnhanceDescEnabled(e.target.checked)} className="rounded" />
                Enhance Description
              </label>
              <label className="flex items-center gap-2 text-sm text-stone-700 cursor-pointer">
                <input type="checkbox" checked={aiImagesEnabled} onChange={(e) => setAiImagesEnabled(e.target.checked)} className="rounded" />
                Generate AI Images
              </label>
            </div>

            {/* Expandable options */}
            <button
              onClick={() => setShowOptions(!showOptions)}
              className="text-xs text-stone-500 hover:text-stone-800 underline"
            >
              {showOptions ? "Hide options" : "Show options"}
            </button>

            {showOptions && (
              <div className="space-y-5 border border-stone-200 rounded-lg p-4 bg-stone-50">
                {/* AI Images section */}
                {aiImagesEnabled && (
                  <div className="space-y-3">
                    <h3 className="text-xs font-medium text-stone-600 uppercase tracking-wide">AI Images</h3>
                    {/* Model picker */}
                    <div>
                      <label className="block text-xs text-stone-500 mb-1">Image Model</label>
                      <select
                        value={selectedModel}
                        onChange={(e) => setSelectedModel(e.target.value)}
                        className="w-full px-2 py-1.5 border border-stone-300 rounded text-sm bg-white"
                      >
                        {imageModels.map((m) => (
                          <option key={m.slug} value={m.slug}>
                            {m.displayName} ({m.creditsPerImage} credits)
                          </option>
                        ))}
                      </select>
                      {imageModels.find((m) => m.slug === selectedModel)?.description && (
                        <p className="text-[10px] text-stone-400 mt-0.5">
                          {imageModels.find((m) => m.slug === selectedModel)?.description}
                        </p>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-stone-500 mb-1">Brand Preset</label>
                        <select value={selectedPresetId} onChange={(e) => {
                          setSelectedPresetId(e.target.value);
                          const p = presets.find((x) => x.id === e.target.value);
                          if (p) setSelectedCollection(Object.keys(p.collection_presets)[0] || "general");
                        }} className="w-full px-2 py-1.5 border border-stone-300 rounded text-sm bg-white">
                          {presets.map((p) => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-stone-500 mb-1">Collection Style</label>
                        <select value={selectedCollection} onChange={(e) => setSelectedCollection(e.target.value)} className="w-full px-2 py-1.5 border border-stone-300 rounded text-sm bg-white">
                          {presetCollections.map((c) => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-stone-500 mb-1">Additional Prompt</label>
                      <textarea value={customPrompt} onChange={(e) => setCustomPrompt(e.target.value)} rows={2} placeholder="Optional extra instructions" className="w-full px-2 py-1.5 border border-stone-300 rounded text-xs bg-white" />
                    </div>
                  </div>
                )}

                {/* Tags */}
                <div>
                  <h3 className="text-xs font-medium text-stone-600 uppercase tracking-wide mb-2">Auto-Add Custom Tags</h3>
                  <input type="text" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="tag1, tag2" className="w-full px-2 py-1.5 border border-stone-300 rounded text-sm" />
                  <p className="text-[10px] text-stone-400 mt-1">Tags applied to all imported products</p>
                </div>

                {/* Collections */}
                <div>
                  <h3 className="text-xs font-medium text-stone-600 uppercase tracking-wide mb-2">Import to Collections</h3>
                  <div className="flex flex-wrap gap-1 mb-2">
                    {collections.map((c) => {
                      const isSelected = selectedCollectionIds.has(c.id);
                      return (
                        <button
                          key={c.id}
                          onClick={() => {
                            setSelectedCollectionIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(c.id)) next.delete(c.id);
                              else next.add(c.id);
                              return next;
                            });
                          }}
                          className={`text-xs px-2 py-1 rounded border ${isSelected ? "bg-indigo-50 border-indigo-300 text-indigo-700" : "border-stone-200 text-stone-500 hover:border-stone-400"}`}
                        >
                          {c.title} {isSelected && "✓"}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newCollectionName}
                      onChange={(e) => setNewCollectionName(e.target.value)}
                      placeholder="New collection name"
                      className="flex-1 px-2 py-1.5 border border-stone-300 rounded text-sm"
                    />
                    <button
                      onClick={handleCreateCollection}
                      disabled={creatingCollection || !newCollectionName.trim()}
                      className="text-xs px-3 py-1.5 bg-stone-800 text-white rounded disabled:opacity-50"
                    >
                      {creatingCollection ? "..." : "Create"}
                    </button>
                  </div>
                </div>

                {/* Pricing */}
                <div>
                  <h3 className="text-xs font-medium text-stone-600 uppercase tracking-wide mb-2">Pricing</h3>
                  <div className="flex gap-3 mb-2">
                    {(["original", "fixed", "markup"] as const).map((mode) => (
                      <label key={mode} className="flex items-center gap-1.5 text-sm text-stone-700 cursor-pointer">
                        <input type="radio" name="pricing" checked={pricingMode === mode} onChange={() => setPricingMode(mode)} />
                        {mode === "original" ? "Original price" : mode === "fixed" ? "Fixed price" : "Original + markup"}
                      </label>
                    ))}
                  </div>
                  {pricingMode === "fixed" && (
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-stone-500">£</span>
                      <input type="text" value={fixedPrice} onChange={(e) => setFixedPrice(e.target.value)} className="w-24 px-2 py-1.5 border border-stone-300 rounded text-sm" />
                    </div>
                  )}
                  {pricingMode === "markup" && (
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-stone-500">Markup</span>
                      <input type="text" value={markupPercent} onChange={(e) => setMarkupPercent(e.target.value)} className="w-16 px-2 py-1.5 border border-stone-300 rounded text-sm" />
                      <span className="text-sm text-stone-500">%</span>
                    </div>
                  )}
                </div>

                {/* Product Status */}
                <div>
                  <h3 className="text-xs font-medium text-stone-600 uppercase tracking-wide mb-2">Product Status</h3>
                  <div className="flex gap-3">
                    <label className={`flex items-center gap-1.5 text-sm cursor-pointer px-3 py-1.5 rounded border ${productStatus === "DRAFT" ? "bg-stone-800 text-white border-stone-800" : "border-stone-300 text-stone-700"}`}>
                      <input type="radio" name="status" checked={productStatus === "DRAFT"} onChange={() => setProductStatus("DRAFT")} className="hidden" />
                      Draft
                    </label>
                    <label className={`flex items-center gap-1.5 text-sm cursor-pointer px-3 py-1.5 rounded border ${productStatus === "ACTIVE" ? "bg-stone-800 text-white border-stone-800" : "border-stone-300 text-stone-700"}`}>
                      <input type="radio" name="status" checked={productStatus === "ACTIVE"} onChange={() => setProductStatus("ACTIVE")} className="hidden" />
                      Active
                    </label>
                  </div>
                  {productStatus === "ACTIVE" && (
                    <p className="text-[10px] text-amber-600 mt-1">Products will be immediately visible in your store.</p>
                  )}
                </div>
              </div>
            )}

            {/* Product list */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-stone-700">
                  {modalSelected.size} of {products.length} products selected
                </h3>
                <button
                  onClick={() => {
                    if (modalSelected.size === products.length) setModalSelected(new Set());
                    else setModalSelected(new Set(products.map((p) => p.handle)));
                  }}
                  className="text-xs text-stone-500 hover:text-stone-800 underline"
                >
                  {modalSelected.size === products.length ? "Deselect all" : "Select all"}
                </button>
              </div>
              <div className="max-h-48 overflow-auto border border-stone-200 rounded-lg divide-y divide-stone-100">
                {products.map((p) => {
                  const isSelected = modalSelected.has(p.handle);
                  const img = p.images[0]?.src;
                  const price = p.variants[0]?.price;
                  return (
                    <div
                      key={p.handle}
                      onClick={() => toggleModalProduct(p.handle)}
                      className={`flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-stone-50 ${isSelected ? "bg-indigo-50/50" : ""}`}
                    >
                      <div className={`w-4 h-4 rounded border-2 flex-shrink-0 flex items-center justify-center ${isSelected ? "bg-indigo-600 border-indigo-600" : "border-stone-300"}`}>
                        {isSelected && (
                          <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </div>
                      {img && <img src={img} alt="" className="w-8 h-8 object-cover rounded" />}
                      <span className="text-sm text-stone-800 flex-1 truncate">{p.title}</span>
                      {price && <span className="text-xs text-stone-500">£{parseFloat(price).toFixed(2)}</span>}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Cost estimate */}
            <div className="text-xs text-stone-500 bg-stone-50 rounded p-3">
              Estimated cost: ~${totalCost.toFixed(2)}
              {aiImagesEnabled && ` (AI images: $${aiImageCost.toFixed(2)})`}
              {translateEnabled && ` (Translation: $${translateCost.toFixed(3)})`}
              {(enhanceTitleEnabled || enhanceDescEnabled) && ` (Enhancement: $${enhanceCost.toFixed(3)})`}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between pt-2 border-t border-stone-200">
              <button onClick={onClose} className="text-sm text-stone-500 hover:text-stone-800 px-4 py-2">Cancel</button>
              <div className="flex gap-2">
                <button
                  onClick={handleImport}
                  disabled={modalSelected.size === 0}
                  className="text-sm border border-stone-300 text-stone-600 px-4 py-2.5 rounded hover:border-stone-500 disabled:opacity-50"
                >
                  Import directly
                </button>
                <button
                  onClick={() => {
                    sessionStorage.setItem(
                      "galleryConfig",
                      JSON.stringify({
                        handles: [...modalSelected],
                        sourceStore,
                      })
                    );
                    window.location.href = "/scan/configure";
                  }}
                  disabled={modalSelected.size === 0}
                  className="text-sm border border-violet-300 text-violet-600 px-4 py-2.5 rounded hover:border-violet-500 disabled:opacity-50"
                >
                  Gallery Mode
                </button>
                <button
                  onClick={async () => {
                    const importOpts = {
                      sourceStore,
                      language,
                      translateEnabled,
                      enhanceTitleEnabled,
                      enhanceDescriptionEnabled: enhanceDescEnabled,
                      aiImagesEnabled,
                      aiImagePresetId: aiImagesEnabled ? selectedPresetId : undefined,
                      aiImageCollection: aiImagesEnabled ? selectedCollection : undefined,
                      aiImageCustomPrompt: aiImagesEnabled && customPrompt.trim() ? customPrompt.trim() : undefined,
                      tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
                      collectionIds: [...selectedCollectionIds],
                      pricingMode,
                      fixedPrice: pricingMode === "fixed" ? fixedPrice : undefined,
                      markupPercent: pricingMode === "markup" ? parseFloat(markupPercent) || 0 : undefined,
                      productStatus,
                      selectedHandles: [...modalSelected],
                    };

                    // 3+ products: use async job queue to avoid Vercel timeouts
                    if (modalSelected.size >= 3) {
                      try {
                        const res = await fetch("/api/jobs/create", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify(importOpts),
                        });
                        const data = await res.json();
                        if (data.jobId) {
                          sessionStorage.setItem("previewOptions", JSON.stringify(importOpts));
                          window.location.href = `/jobs/${data.jobId}`;
                          return;
                        }
                      } catch { /* fall through to SSE preview */ }
                    }

                    // 1-2 products: quick SSE preview
                    sessionStorage.setItem("previewOptions", JSON.stringify(importOpts));
                    window.location.href = `/scan/preview?store=${sourceStore}`;
                  }}
                  disabled={modalSelected.size === 0}
                  className="text-sm bg-indigo-600 text-white px-6 py-2.5 rounded hover:bg-indigo-700 disabled:opacity-50 font-medium"
                >
                  Preview {modalSelected.size} Product{modalSelected.size !== 1 ? "s" : ""}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* PHASE: Importing */}
        {phase === "importing" && (
          <div className="p-6 space-y-4">
            <div className="text-center">
              <div className="w-8 h-8 border-4 border-stone-200 border-t-indigo-600 rounded-full animate-spin mx-auto mb-3" />
              <p className="text-sm font-medium text-stone-800">
                Importing product {progress.current} of {progress.total}
              </p>
              <p className="text-xs text-stone-500 mt-1">{currentStep}</p>
            </div>

            {/* Progress bar */}
            <div className="h-1.5 bg-stone-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-600 rounded-full transition-all duration-500"
                style={{ width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%` }}
              />
            </div>

            {/* Completed products list */}
            {results.length > 0 && (
              <div className="max-h-40 overflow-auto border border-stone-200 rounded divide-y divide-stone-100">
                {results.map((r, i) => (
                  <div key={i} className="flex items-center gap-2 px-3 py-2 text-sm">
                    {r.success ? (
                      <span className="text-green-600 flex-shrink-0">✓</span>
                    ) : (
                      <span className="text-red-500 flex-shrink-0">✗</span>
                    )}
                    <span className={`flex-1 truncate ${r.success ? "text-stone-800" : "text-red-700"}`}>
                      {r.title || r.handle}
                    </span>
                    {r.success && r.adminUrl && (
                      <a href={r.adminUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-600 hover:text-indigo-800 flex-shrink-0">
                        View
                      </a>
                    )}
                    {!r.success && r.error && (
                      <span className="text-[10px] text-red-500 flex-shrink-0 max-w-[200px] truncate">{r.error}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* PHASE: Done */}
        {phase === "done" && summary && (
          <div className="p-6 space-y-4">
            <div className="text-center">
              {summary.failed === 0 ? (
                <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                  <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              ) : (
                <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-3">
                  <span className="text-amber-600 text-xl">!</span>
                </div>
              )}
              <p className="text-sm font-medium text-stone-800">
                {summary.success} product{summary.success !== 1 ? "s" : ""} imported
                {summary.failed > 0 && `, ${summary.failed} failed`}
              </p>
            </div>

            {/* Results list */}
            <div className="max-h-60 overflow-auto border border-stone-200 rounded divide-y divide-stone-100">
              {results.map((r, i) => (
                <div key={i} className="flex items-center gap-2 px-3 py-2 text-sm">
                  {r.success ? (
                    <span className="text-green-600 flex-shrink-0">✓</span>
                  ) : (
                    <span className="text-red-500 flex-shrink-0">✗</span>
                  )}
                  <span className={`flex-1 truncate ${r.success ? "text-stone-800" : "text-red-700"}`}>
                    {r.title || r.handle}
                  </span>
                  {r.success && r.adminUrl && (
                    <a href={r.adminUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-600 hover:text-indigo-800 flex-shrink-0">
                      View on Shopify
                    </a>
                  )}
                  {!r.success && (
                    <span className="text-[10px] text-red-500 flex-shrink-0 max-w-[200px] truncate">{r.error}</span>
                  )}
                </div>
              ))}
            </div>

            <div className="flex justify-center gap-3 pt-2">
              <button onClick={onClose} className="text-sm bg-indigo-600 text-white px-6 py-2.5 rounded hover:bg-indigo-700 font-medium">
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
