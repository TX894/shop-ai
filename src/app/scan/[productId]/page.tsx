"use client";

import { useEffect, useState, Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import Results from "@/components/Results";
import ProgressBar from "@/components/ProgressBar";
import PresetSelector from "@/components/PresetSelector";
import { processStream } from "@/lib/process-stream";
import type { ImageStatus } from "@/lib/process-stream";
import type { ShopifyProduct, ShopifyImage } from "@/types/shopify";
import type {
  Preset,
  ImageRole,
  ProcessRequest,
  ProcessResultItem,
} from "@/types/preset";
import type { UploadedImage } from "@/components/Uploader";

function ProductDetailInner() {
  const params = useParams<{ productId: string }>();
  const searchParams = useSearchParams();
  const handle = params.productId;
  const store = searchParams.get("store") ?? "";

  const [product, setProduct] = useState<ShopifyProduct | null>(null);
  const [loadingProduct, setLoadingProduct] = useState(true);
  const [productError, setProductError] = useState("");

  // Preset state
  const [presets, setPresets] = useState<Preset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [selectedCollection, setSelectedCollection] = useState("general");
  const [customPrompt, setCustomPrompt] = useState("");

  // Image selection
  const [selectedImages, setSelectedImages] = useState<Set<number>>(new Set());
  const [imageRoles, setImageRoles] = useState<Record<number, ImageRole>>({});

  // Processing
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState({ done: 0, total: 0 });
  const [processing, setProcessing] = useState(false);
  const [imageStatuses, setImageStatuses] = useState<ImageStatus[]>([]);
  const [processingStartTime, setProcessingStartTime] = useState(0);
  const [results, setResults] = useState<ProcessResultItem[]>([]);
  const [originals, setOriginals] = useState<UploadedImage[]>([]);
  const [processError, setProcessError] = useState("");

  // Load product
  useEffect(() => {
    if (!handle || !store) return;
    setLoadingProduct(true);
    fetch(
      `/api/scan/product?store=${encodeURIComponent(store)}&handle=${encodeURIComponent(handle)}`
    )
      .then((r) => r.json())
      .then((data: { product?: ShopifyProduct; error?: string }) => {
        if (data.error) throw new Error(data.error);
        if (!data.product) throw new Error("Produto não encontrado");
        setProduct(data.product);
        const allIndices = new Set(data.product.images.map((_, i) => i));
        setSelectedImages(allIndices);
        const roles: Record<number, ImageRole> = {};
        data.product.images.forEach((_, i) => {
          roles[i] = "hero";
        });
        setImageRoles(roles);
      })
      .catch((err: unknown) =>
        setProductError(
          err instanceof Error ? err.message : "Erro ao carregar produto"
        )
      )
      .finally(() => setLoadingProduct(false));
  }, [handle, store]);

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

  function toggleImage(index: number) {
    setSelectedImages((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function setRole(index: number, role: ImageRole) {
    setImageRoles((prev) => ({ ...prev, [index]: role }));
  }

  async function handleGenerate() {
    if (!product || selectedImages.size === 0 || !selectedPresetId) return;

    const selectedList = [...selectedImages].sort((a, b) => a - b);
    const imagesToProcess: ShopifyImage[] = selectedList.map(
      (i) => product.images[i]
    );
    const total = imagesToProcess.length;

    // Reset state
    setDownloading(true);
    setDownloadProgress({ done: 0, total });
    setProcessError("");
    setResults([]);
    setOriginals([]);
    setImageStatuses([]);

    let proxied: UploadedImage[];
    try {
      // Phase 1: proxy-download images (sequential, shows download counter)
      proxied = [];
      for (const img of imagesToProcess) {
        const res = await fetch(
          `/api/scan/image-proxy?url=${encodeURIComponent(img.src)}`
        );
        if (!res.ok)
          throw new Error(`Erro ao descarregar imagem: HTTP ${res.status}`);
        const data = (await res.json()) as {
          imageBase64: string;
          mimeType: string;
        };
        proxied.push({
          id: String(img.id),
          file: new File([], img.alt || "image"),
          base64: data.imageBase64,
          mimeType: data.mimeType,
          previewUrl: img.src,
        });
        setDownloadProgress({ done: proxied.length, total });
      }
    } catch (err) {
      setProcessError(err instanceof Error ? err.message : "Erro ao descarregar imagens");
      setDownloading(false);
      return;
    }

    setDownloading(false);
    setOriginals(proxied);

    // Phase 2: AI processing via SSE stream
    setProcessing(true);
    setImageStatuses(new Array<ImageStatus>(total).fill("pending"));
    setProcessingStartTime(Date.now());

    const body: ProcessRequest = {
      presetId: selectedPresetId,
      items: proxied.map((img, i) => ({
        imageBase64: img.base64,
        mimeType: img.mimeType,
        role: imageRoles[selectedList[i]] ?? "hero",
        collection: selectedCollection,
        customPrompt: customPrompt.trim() || undefined,
      })),
    };

    await processStream(body, {
      onProcessing: (index) => {
        setImageStatuses((prev) => {
          const next = [...prev];
          next[index] = "processing";
          return next;
        });
      },
      onResult: (result) => {
        setImageStatuses((prev) => {
          const next = [...prev];
          next[result.index] = result.success ? "done" : "error";
          return next;
        });
        setResults((prev) => {
          const next = [...prev];
          next[result.index] = result;
          return next;
        });
      },
      onComplete: () => setProcessing(false),
      onStreamError: (message) => {
        setProcessError(message);
        setProcessing(false);
      },
    });
  }

  if (loadingProduct) {
    return (
      <div className="text-center py-16 text-stone-500 text-sm">
        A carregar produto…
      </div>
    );
  }

  if (productError) {
    return (
      <div className="text-sm bg-red-50 border border-red-200 text-red-700 rounded p-3">
        {productError}
      </div>
    );
  }

  if (!product) return null;

  const selectedCount = selectedImages.size;
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

  const showProgress =
    processing || imageStatuses.some((s) => s !== "pending");
  const thumbnails = originals.map((o) => o.previewUrl);
  const displayResults = (results as (ProcessResultItem | undefined)[]).filter(
    (r): r is ProcessResultItem => r !== undefined
  );

  return (
    <div className="space-y-6">
      {/* Product header */}
      <div>
        <h1 className="text-2xl font-medium text-stone-800">{product.title}</h1>
        <p className="text-sm text-stone-500 mt-1">
          {[product.vendor, product.product_type].filter(Boolean).join(" · ")}
          {product.variants[0] && (
            <span className="ml-2 font-medium text-stone-700">
              £{parseFloat(product.variants[0].price).toFixed(2)}
            </span>
          )}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Left: images */}
        <div className="md:col-span-2">
          <p className="text-sm font-medium text-stone-700 mb-3">
            Imagens ({selectedCount} de {product.images.length} selecionadas)
          </p>
          <div className="grid grid-cols-2 gap-3">
            {product.images.map((img, i) => {
              const isSelected = selectedImages.has(i);
              return (
                <div
                  key={img.id}
                  className={`relative bg-white rounded-lg border overflow-hidden ${
                    isSelected
                      ? "border-stone-800 ring-2 ring-stone-800"
                      : "border-stone-200"
                  }`}
                >
                  <div className="cursor-pointer" onClick={() => toggleImage(i)}>
                    <div className="absolute top-2 left-2 z-10">
                      <div
                        className={`w-5 h-5 rounded border-2 flex items-center justify-center ${
                          isSelected
                            ? "bg-stone-800 border-stone-800"
                            : "bg-white border-stone-300"
                        }`}
                      >
                        {isSelected && (
                          <svg
                            className="w-3 h-3 text-white"
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
                    <div className="aspect-square bg-stone-100">
                      <img
                        src={img.src}
                        alt={img.alt || product.title}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  </div>
                  <div className="p-2">
                    <select
                      value={imageRoles[i] ?? "hero"}
                      onChange={(e) => setRole(i, e.target.value as ImageRole)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-full text-xs px-2 py-1 border border-stone-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-stone-400"
                    >
                      <option value="hero">hero</option>
                      <option value="detail">detail</option>
                      <option value="lifestyle">lifestyle</option>
                    </select>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: controls */}
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
                Adicionado ao estilo base do preset.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleGenerate}
            disabled={
              downloading || processing || selectedCount === 0 || !selectedPresetId
            }
            className="w-full bg-stone-800 text-white py-3 rounded hover:bg-stone-900 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
          >
            {downloading
              ? `A descarregar ${downloadProgress.done}/${downloadProgress.total}…`
              : processing
              ? "A gerar…"
              : `Gerar ${selectedCount} imagem${selectedCount === 1 ? "" : "s"} AI`}
          </button>

          {processError && (
            <div className="text-sm bg-red-50 border border-red-200 text-red-700 rounded p-3">
              {processError}
            </div>
          )}
        </div>
      </div>

      {showProgress && (
        <ProgressBar
          thumbnails={thumbnails}
          statuses={imageStatuses}
          startTime={processingStartTime}
        />
      )}

      {displayResults.length > 0 && (
        <Results
          originals={originals}
          results={displayResults}
          onRegenerate={handleRegenerate}
          onDiscard={handleDiscard}
        />
      )}
    </div>
  );
}

export default function ProductDetailPage() {
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
              A carregar…
            </div>
          }
        >
          <ProductDetailInner />
        </Suspense>
      </div>
    </main>
  );
}
