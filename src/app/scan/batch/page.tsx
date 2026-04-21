"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Results from "@/components/Results";
import ProgressBar from "@/components/ProgressBar";
import PresetSelector from "@/components/PresetSelector";
import { processStream } from "@/lib/process-stream";
import type { ImageStatus } from "@/lib/process-stream";
import type { ShopifyProduct } from "@/types/shopify";
import type {
  Preset,
  ImageRole,
  ProcessRequest,
  ProcessResultItem,
} from "@/types/preset";
import type { UploadedImage } from "@/components/Uploader";

const DEFAULT_ROLES: ImageRole[] = ["hero", "detail", "lifestyle"];

interface ProductData {
  handle: string;
  product: ShopifyProduct | null;
  loading: boolean;
  error: string | null;
}

// Per-image selection state for detailed mode
interface ImageSelection {
  selected: boolean;
  role: ImageRole;
}

// Flat item ready for processing
interface BatchItem {
  productHandle: string;
  productTitle: string;
  imageUrl: string;
  imageBase64: string;
  imageMime: string;
  role: ImageRole;
}

function BatchInner() {
  const searchParams = useSearchParams();
  const store = searchParams.get("store") ?? "";
  const idsParam = searchParams.get("ids") ?? "";

  // Resolve handles from query string or sessionStorage
  const [handles, setHandles] = useState<string[]>([]);
  useEffect(() => {
    if (idsParam) {
      setHandles(idsParam.split(",").filter(Boolean));
    } else {
      try {
        const stored = sessionStorage.getItem("batchIds");
        if (stored) {
          const parsed = JSON.parse(stored) as string[];
          setHandles(parsed);
        }
      } catch {
        // ignore
      }
    }
  }, [idsParam]);

  // Product data
  const [products, setProducts] = useState<ProductData[]>([]);
  const [allLoaded, setAllLoaded] = useState(false);

  // Mode toggle
  const [detailedMode, setDetailedMode] = useState(false);

  // Detailed mode: per-product per-image selections
  // Key: "handle:imageIndex"
  const [imageSelections, setImageSelections] = useState<
    Record<string, ImageSelection>
  >({});

  // Preset state
  const [presets, setPresets] = useState<Preset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [selectedCollection, setSelectedCollection] = useState("general");
  const [customPrompt, setCustomPrompt] = useState("");

  // Processing state
  const [phase, setPhase] = useState<
    "idle" | "downloading" | "processing" | "done"
  >("idle");
  const [downloadProgress, setDownloadProgress] = useState({ done: 0, total: 0 });
  const [imageStatuses, setImageStatuses] = useState<ImageStatus[]>([]);
  const [processingStartTime, setProcessingStartTime] = useState(0);
  const [results, setResults] = useState<ProcessResultItem[]>([]);
  const [originals, setOriginals] = useState<UploadedImage[]>([]);
  const [processError, setProcessError] = useState("");

  // For batch save
  const [savingAll, setSavingAll] = useState(false);
  const [savedAll, setSavedAll] = useState(false);

  // Track which flat index belongs to which product
  const [flatItems, setFlatItems] = useState<BatchItem[]>([]);

  // Load presets
  useEffect(() => {
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
  }, []);

  // Load product data for each handle
  const loadProducts = useCallback(async () => {
    if (!store || handles.length === 0) return;

    const initial: ProductData[] = handles.map((h) => ({
      handle: h,
      product: null,
      loading: true,
      error: null,
    }));
    setProducts(initial);

    const settled = await Promise.allSettled(
      handles.map(async (handle) => {
        const res = await fetch(
          `/api/scan/product?store=${encodeURIComponent(store)}&handle=${encodeURIComponent(handle)}`
        );
        let data: { product?: ShopifyProduct; error?: string };
        try {
          data = await res.json();
        } catch {
          throw new Error(`Resposta inválida para ${handle}`);
        }
        if (!res.ok || data.error) {
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        const product = data.product;
        if (!product || !Array.isArray(product.images)) {
          throw new Error("Produto sem imagens");
        }
        return { handle, product };
      })
    );

    const loaded: ProductData[] = settled.map((result, i) => {
      if (result.status === "fulfilled") {
        return {
          handle: result.value.handle,
          product: result.value.product,
          loading: false,
          error: null,
        };
      }
      return {
        handle: handles[i],
        product: null,
        loading: false,
        error: result.reason instanceof Error ? result.reason.message : "Erro ao carregar",
      };
    });

    setProducts(loaded);
    setAllLoaded(true);

    // Initialize default image selections (only for products that loaded successfully)
    const sel: Record<string, ImageSelection> = {};
    for (const pd of loaded) {
      if (!pd.product?.images) continue;
      pd.product.images.forEach((_, i) => {
        const key = `${pd.handle}:${i}`;
        const isDefault = i < 3;
        sel[key] = {
          selected: isDefault,
          role: DEFAULT_ROLES[i] ?? "hero",
        };
      });
    }
    setImageSelections(sel);
  }, [store, handles]);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  // Compute smart defaults for each product
  function getSmartItems(pd: ProductData): { index: number; role: ImageRole }[] {
    if (!pd.product?.images?.length) return [];
    const count = Math.min(3, pd.product.images.length);
    return Array.from({ length: count }, (_, i) => ({
      index: i,
      role: DEFAULT_ROLES[i],
    }));
  }

  // Get selected items based on current mode
  function getSelectedItems(): {
    handle: string;
    product: ShopifyProduct;
    images: { index: number; role: ImageRole }[];
  }[] {
    return products
      .filter((pd) => pd.product?.images?.length)
      .map((pd) => {
        const product = pd.product!;
        let images: { index: number; role: ImageRole }[];

        if (detailedMode) {
          images = product.images
            .map((_, i) => {
              const key = `${pd.handle}:${i}`;
              const sel = imageSelections[key];
              if (sel?.selected) return { index: i, role: sel.role };
              return null;
            })
            .filter((x): x is { index: number; role: ImageRole } => x !== null);
        } else {
          images = getSmartItems(pd);
        }

        return { handle: pd.handle, product, images };
      })
      .filter((x) => x.images.length > 0);
  }

  const selectedItems = getSelectedItems();
  const totalImages = selectedItems.reduce((sum, x) => sum + x.images.length, 0);
  const totalImagesAllProducts = products.reduce(
    (sum, pd) => sum + (pd.product?.images.length ?? 0),
    0
  );

  function toggleImageSelection(handle: string, index: number) {
    const key = `${handle}:${index}`;
    setImageSelections((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        selected: !prev[key]?.selected,
      },
    }));
  }

  function setImageRole(handle: string, index: number, role: ImageRole) {
    const key = `${handle}:${index}`;
    setImageSelections((prev) => ({
      ...prev,
      [key]: { ...prev[key], role },
    }));
  }

  async function handleGenerate() {
    if (totalImages === 0 || !selectedPresetId) return;

    // Build flat list of items to process
    const items = selectedItems;
    const flat: BatchItem[] = [];
    for (const item of items) {
      for (const img of item.images) {
        flat.push({
          productHandle: item.handle,
          productTitle: item.product.title,
          imageUrl: item.product.images[img.index].src,
          imageBase64: "",
          imageMime: "",
          role: img.role,
        });
      }
    }

    const total = flat.length;
    setPhase("downloading");
    setDownloadProgress({ done: 0, total });
    setProcessError("");
    setResults([]);
    setOriginals([]);
    setImageStatuses([]);
    setSavedAll(false);

    // Phase 1: download all images via proxy
    try {
      for (let i = 0; i < flat.length; i++) {
        const res = await fetch(
          `/api/scan/image-proxy?url=${encodeURIComponent(flat[i].imageUrl)}`
        );
        if (!res.ok)
          throw new Error(`Erro ao descarregar imagem: HTTP ${res.status}`);
        const data = (await res.json()) as {
          imageBase64: string;
          mimeType: string;
        };
        flat[i].imageBase64 = data.imageBase64;
        flat[i].imageMime = data.mimeType;
        setDownloadProgress({ done: i + 1, total });
      }
    } catch (err) {
      setProcessError(
        err instanceof Error ? err.message : "Erro ao descarregar imagens"
      );
      setPhase("idle");
      return;
    }

    setFlatItems(flat);

    // Build originals for Results component
    const origs: UploadedImage[] = flat.map((item, i) => ({
      id: `batch-${i}`,
      file: new File([], "image"),
      base64: item.imageBase64,
      mimeType: item.imageMime,
      previewUrl: item.imageUrl,
    }));
    setOriginals(origs);

    // Phase 2: AI processing — one image at a time to avoid body size limits
    setPhase("processing");
    setImageStatuses(new Array<ImageStatus>(total).fill("pending"));
    setProcessingStartTime(Date.now());

    for (let i = 0; i < flat.length; i++) {
      const item = flat[i];

      // Mark as processing
      setImageStatuses((prev) => {
        const next = [...prev];
        next[i] = "processing";
        return next;
      });

      const body: ProcessRequest = {
        presetId: selectedPresetId,
        items: [
          {
            imageBase64: item.imageBase64,
            mimeType: item.imageMime,
            role: item.role,
            collection: selectedCollection,
            customPrompt: customPrompt.trim() || undefined,
          },
        ],
      };

      let gotResult = false;
      await processStream(body, {
        onProcessing: () => {},
        onResult: (result) => {
          gotResult = true;
          // Remap index 0 → i (the batch-level index)
          const mapped = { ...result, index: i };
          setImageStatuses((prev) => {
            const next = [...prev];
            next[i] = mapped.success ? "done" : "error";
            return next;
          });
          setResults((prev) => {
            const next = [...prev];
            next[i] = mapped;
            return next;
          });
        },
        onComplete: () => {},
        onStreamError: (message) => {
          if (!gotResult) {
            setImageStatuses((prev) => {
              const next = [...prev];
              next[i] = "error";
              return next;
            });
            setResults((prev) => {
              const next = [...prev];
              next[i] = {
                index: i,
                success: false,
                error: message,
              };
              return next;
            });
          }
        },
      });
    }

    setPhase("done");
  }

  function handleRegenerate(index: number, newResult: ProcessResultItem) {
    setResults((prev) => {
      const idx = prev.findIndex((r) => r?.index === index);
      if (idx === -1) return [...prev, newResult];
      const next = [...prev];
      next[idx] = newResult;
      return next;
    });
  }

  function handleDiscard(index: number) {
    setResults((prev) =>
      prev.filter((r) => r !== undefined && r.index !== index)
    );
  }

  async function handleSaveAll() {
    setSavingAll(true);
    const successResults = (results as (ProcessResultItem | undefined)[]).filter(
      (r): r is ProcessResultItem => r !== undefined && r.success === true && !!r.imageBase64
    );

    for (const r of successResults) {
      const orig = originals[r.index];
      if (!orig) continue;
      try {
        await fetch("/api/library", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            presetId: selectedPresetId,
            collection: selectedCollection,
            role: flatItems[r.index]?.role ?? "hero",
            prompt: r.prompt,
            originalBase64: orig.base64,
            originalMime: orig.mimeType,
            resultBase64: r.imageBase64,
            resultMime: r.mimeType,
            notes: flatItems[r.index]?.productTitle,
          }),
        });
      } catch {
        // continue saving others
      }
    }
    setSavingAll(false);
    setSavedAll(true);
  }

  const showProgress =
    phase === "processing" || imageStatuses.some((s) => s !== "pending");
  const thumbnails = originals.map((o) => o.previewUrl);
  const displayResults = (results as (ProcessResultItem | undefined)[]).filter(
    (r): r is ProcessResultItem => r !== undefined
  );

  // Group results by product for display
  function groupResultsByProduct(): {
    handle: string;
    title: string;
    startIndex: number;
    count: number;
  }[] {
    if (flatItems.length === 0) return [];
    const groups: {
      handle: string;
      title: string;
      startIndex: number;
      count: number;
    }[] = [];
    let current = flatItems[0].productHandle;
    let start = 0;
    let count = 0;

    for (let i = 0; i < flatItems.length; i++) {
      if (flatItems[i].productHandle !== current) {
        groups.push({
          handle: current,
          title: flatItems[start].productTitle,
          startIndex: start,
          count,
        });
        current = flatItems[i].productHandle;
        start = i;
        count = 0;
      }
      count++;
    }
    groups.push({
      handle: current,
      title: flatItems[start].productTitle,
      startIndex: start,
      count,
    });
    return groups;
  }

  if (handles.length === 0) {
    return (
      <div className="text-center py-20 text-stone-400">
        <p className="text-lg mb-2">Nenhum produto selecionado</p>
        <p className="text-sm">
          Volta ao{" "}
          <Link href="/scan" className="underline hover:text-stone-600">
            scan
          </Link>{" "}
          e seleciona produtos.
        </p>
      </div>
    );
  }

  const anyLoading = products.some((p) => p.loading);

  return (
    <div className="space-y-6">
      {/* Header summary */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-medium text-stone-800">Batch</h1>
          <p className="text-sm text-stone-500 mt-1">
            {allLoaded
              ? `${products.filter((p) => p.product).length} produtos · ${totalImages} imagens para processar`
              : "A carregar produtos..."}
          </p>
        </div>
      </div>

      {/* Failed products warning */}
      {allLoaded && products.some((p) => p.error) && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
          <p className="font-medium mb-1">
            {products.filter((p) => p.error).length} produto{products.filter((p) => p.error).length > 1 ? "s" : ""} não carregou:
          </p>
          <ul className="list-disc list-inside text-xs text-amber-700">
            {products
              .filter((p) => p.error)
              .map((p) => (
                <li key={p.handle}>
                  {p.handle}: {p.error}
                </li>
              ))}
          </ul>
        </div>
      )}

      {/* Mode toggle */}
      {allLoaded && phase === "idle" && (
        <div className="flex items-center gap-3">
          <button
            onClick={() => setDetailedMode(false)}
            className={`text-sm px-3 py-1.5 rounded ${
              !detailedMode
                ? "bg-stone-800 text-white"
                : "border border-stone-300 text-stone-600 hover:border-stone-500"
            }`}
          >
            Smart default
          </button>
          <button
            onClick={() => setDetailedMode(true)}
            className={`text-sm px-3 py-1.5 rounded ${
              detailedMode
                ? "bg-stone-800 text-white"
                : "border border-stone-300 text-stone-600 hover:border-stone-500"
            }`}
          >
            Revisão detalhada
          </button>
          {detailedMode && (
            <span className="text-xs text-stone-400">
              {totalImages} de {totalImagesAllProducts} imagens selecionadas
            </span>
          )}
        </div>
      )}

      {/* Global config + product list */}
      {allLoaded && phase === "idle" && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Left: product list */}
          <div className="md:col-span-2 space-y-4">
            {products.map((pd) => {
              if (pd.loading) {
                return (
                  <div
                    key={pd.handle}
                    className="bg-white rounded-lg border border-stone-200 p-4 text-sm text-stone-500"
                  >
                    A carregar {pd.handle}...
                  </div>
                );
              }
              if (pd.error || !pd.product) {
                return (
                  <div
                    key={pd.handle}
                    className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700"
                  >
                    {pd.handle}: {pd.error ?? "Produto não encontrado"}
                  </div>
                );
              }

              const product = pd.product;
              const smartItems = getSmartItems(pd);

              if (!detailedMode) {
                // Smart default: compact summary
                return (
                  <div
                    key={pd.handle}
                    className="bg-white rounded-lg border border-stone-200 p-4"
                  >
                    <div className="flex gap-3">
                      {product.images[0] && (
                        <img
                          src={product.images[0].src}
                          alt={product.title}
                          className="w-16 h-16 object-cover rounded"
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-stone-800 truncate">
                          {product.title}
                        </p>
                        <p className="text-xs text-stone-500 mt-0.5">
                          {smartItems.length} imagem
                          {smartItems.length !== 1 ? "s" : ""} —{" "}
                          {smartItems.map((si) => si.role).join(", ")}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              }

              // Detailed mode: full image grid with checkboxes and role selectors
              return (
                <div
                  key={pd.handle}
                  className="bg-white rounded-lg border border-stone-200 overflow-hidden"
                >
                  <div className="p-4 border-b border-stone-100">
                    <p className="text-sm font-medium text-stone-800">
                      {product.title}
                    </p>
                    <p className="text-xs text-stone-400 mt-0.5">
                      {
                        product.images.filter(
                          (_, i) =>
                            imageSelections[`${pd.handle}:${i}`]?.selected
                        ).length
                      }{" "}
                      de {product.images.length} selecionadas
                    </p>
                  </div>
                  <div className="p-4">
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                      {product.images.map((img, i) => {
                        const key = `${pd.handle}:${i}`;
                        const sel = imageSelections[key];
                        const isSelected = sel?.selected ?? false;
                        const role = sel?.role ?? "hero";

                        return (
                          <div key={img.id} className="space-y-1">
                            <div
                              onClick={() =>
                                toggleImageSelection(pd.handle, i)
                              }
                              className={`relative aspect-square rounded border-2 overflow-hidden cursor-pointer transition ${
                                isSelected
                                  ? "border-stone-800 ring-1 ring-stone-800"
                                  : "border-stone-200 opacity-50"
                              }`}
                            >
                              <img
                                src={img.src}
                                alt={img.alt || product.title}
                                className="w-full h-full object-cover"
                              />
                              <div className="absolute top-1 left-1">
                                <div
                                  className={`w-4 h-4 rounded border-2 flex items-center justify-center ${
                                    isSelected
                                      ? "bg-stone-800 border-stone-800"
                                      : "bg-white border-stone-300"
                                  }`}
                                >
                                  {isSelected && (
                                    <svg
                                      className="w-2.5 h-2.5 text-white"
                                      fill="none"
                                      viewBox="0 0 24 24"
                                      stroke="currentColor"
                                      strokeWidth={3}
                                    >
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        d="M5 13l4 4L19 7"
                                      />
                                    </svg>
                                  )}
                                </div>
                              </div>
                            </div>
                            {isSelected && (
                              <select
                                value={role}
                                onChange={(e) =>
                                  setImageRole(
                                    pd.handle,
                                    i,
                                    e.target.value as ImageRole
                                  )
                                }
                                className="w-full text-[10px] px-1 py-0.5 border border-stone-200 rounded bg-white focus:outline-none"
                              >
                                <option value="hero">hero</option>
                                <option value="detail">detail</option>
                                <option value="lifestyle">lifestyle</option>
                              </select>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Right: global controls */}
          <div className="space-y-4">
            <div className="bg-white p-4 rounded-lg border border-stone-200">
              <PresetSelector
                presets={presets}
                selectedId={selectedPresetId}
                onChange={(id) => {
                  setSelectedPresetId(id);
                  const preset = presets.find((p) => p.id === id);
                  const firstColl = preset
                    ? Object.keys(preset.collection_presets)[0]
                    : "general";
                  setSelectedCollection(firstColl || "general");
                }}
                selectedCollection={selectedCollection}
                onCollectionChange={setSelectedCollection}
              />

              <div className="mt-4">
                <label className="block text-sm font-medium text-stone-700 mb-1">
                  Prompt adicional (opcional)
                </label>
                <textarea
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  placeholder="ex: fundo de veludo preto, iluminação dramática"
                  rows={4}
                  className="w-full px-3 py-2 border border-stone-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-stone-400"
                />
                <p className="text-xs text-stone-400 mt-1">
                  Aplica-se a todas as imagens do batch.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleGenerate}
              disabled={anyLoading || totalImages === 0 || !selectedPresetId}
              className="w-full bg-stone-800 text-white py-3 rounded hover:bg-stone-900 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
            >
              Gerar {totalImages} imagem{totalImages === 1 ? "" : "s"}
            </button>

            {processError && (
              <div className="text-sm bg-red-50 border border-red-200 text-red-700 rounded p-3">
                {processError}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Downloading phase */}
      {phase === "downloading" && (
        <div className="bg-white border border-stone-200 rounded-lg p-6 text-center">
          <div className="w-8 h-8 border-4 border-stone-200 border-t-stone-800 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-stone-700">
            A descarregar imagens... {downloadProgress.done}/{downloadProgress.total}
          </p>
        </div>
      )}

      {/* Processing phase */}
      {showProgress && (
        <ProgressBar
          thumbnails={thumbnails}
          statuses={imageStatuses}
          startTime={processingStartTime}
        />
      )}

      {/* Results grouped by product */}
      {displayResults.length > 0 && (
        <div className="space-y-8">
          {/* Batch save button */}
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium text-stone-800">Resultados</h2>
            <button
              type="button"
              onClick={handleSaveAll}
              disabled={savingAll || savedAll}
              className={`text-sm px-4 py-2 rounded ${
                savedAll
                  ? "bg-green-50 border border-green-300 text-green-700"
                  : "bg-stone-800 text-white hover:bg-stone-900"
              } disabled:opacity-70`}
            >
              {savedAll
                ? "Tudo guardado"
                : savingAll
                ? "A guardar..."
                : `Guardar todos (${displayResults.filter((r) => r.success).length})`}
            </button>
          </div>

          {/* Group by product */}
          {groupResultsByProduct().map((group) => {
            const groupOriginals = originals.slice(
              group.startIndex,
              group.startIndex + group.count
            );
            const groupResults = displayResults.filter(
              (r) =>
                r.index >= group.startIndex &&
                r.index < group.startIndex + group.count
            );

            if (groupResults.length === 0) return null;

            return (
              <div key={group.handle}>
                <h3 className="text-sm font-medium text-stone-600 mb-3">
                  {group.title}{" "}
                  <span className="text-stone-400 font-normal">
                    ({group.count} imagem{group.count !== 1 ? "s" : ""})
                  </span>
                </h3>
                <Results
                  originals={groupOriginals}
                  results={groupResults.map((r) => ({
                    ...r,
                    index: r.index - group.startIndex,
                  }))}
                  presetId={selectedPresetId}
                  collection={selectedCollection}
                  onRegenerate={(localIndex, newResult) =>
                    handleRegenerate(localIndex + group.startIndex, {
                      ...newResult,
                      index: localIndex + group.startIndex,
                    })
                  }
                  onDiscard={(localIndex) =>
                    handleDiscard(localIndex + group.startIndex)
                  }
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function BatchPage() {
  return (
    <main className="min-h-screen bg-stone-50">
      <div className="max-w-5xl mx-auto p-6 md:p-10">
        <header className="mb-8">
          <Link
            href="/scan"
            className="text-sm text-stone-500 hover:text-stone-800 mb-3 inline-block"
          >
            ← Voltar ao scan
          </Link>
        </header>
        <Suspense
          fallback={
            <div className="text-center py-16 text-stone-500 text-sm">
              A carregar...
            </div>
          }
        >
          <BatchInner />
        </Suspense>
      </div>
    </main>
  );
}
