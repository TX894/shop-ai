"use client";

import { useEffect, useState } from "react";
import Uploader, { UploadedImage } from "@/components/Uploader";
import Header from "@/components/Header";
import PresetSelector from "@/components/PresetSelector";
import QueueItem from "@/components/QueueItem";
import Results from "@/components/Results";
import ProgressBar from "@/components/ProgressBar";
import { processStream } from "@/lib/process-stream";
import type { ImageStatus } from "@/lib/process-stream";
import type {
  Preset,
  ImageRole,
  ProcessRequest,
  ProcessResultItem,
} from "@/types/preset";

export default function Home() {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [selectedCollection, setSelectedCollection] = useState("general");
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [roles, setRoles] = useState<Record<string, ImageRole>>({});
  const [customPrompt, setCustomPrompt] = useState("");
  const [processing, setProcessing] = useState(false);
  const [imageStatuses, setImageStatuses] = useState<ImageStatus[]>([]);
  const [processingStartTime, setProcessingStartTime] = useState(0);
  const [results, setResults] = useState<ProcessResultItem[]>([]);
  const [error, setError] = useState("");

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
      .catch(() => setError("Failed to load presets"));
  }, []);

  function addImages(newImages: UploadedImage[]) {
    setImages((prev) => [...prev, ...newImages]);
    setRoles((prev) => {
      const next = { ...prev };
      for (const img of newImages) {
        if (!next[img.id]) next[img.id] = "hero";
      }
      return next;
    });
  }

  function removeImage(id: string) {
    setImages((prev) => prev.filter((i) => i.id !== id));
    setRoles((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  function changeRole(id: string, role: ImageRole) {
    setRoles((prev) => ({ ...prev, [id]: role }));
  }

  async function handleProcess() {
    if (images.length === 0 || !selectedPresetId) return;

    const total = images.length;
    setProcessing(true);
    setError("");
    setResults([]);
    setImageStatuses(new Array<ImageStatus>(total).fill("pending"));
    setProcessingStartTime(Date.now());

    const body: ProcessRequest = {
      presetId: selectedPresetId,
      items: images.map((img) => ({
        imageBase64: img.base64,
        mimeType: img.mimeType,
        role: roles[img.id] || "hero",
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
          // Insert at correct index slot
          const next = [...prev];
          next[result.index] = result;
          return next;
        });
      },
      onComplete: () => setProcessing(false),
      onStreamError: (message) => {
        setError(message);
        setProcessing(false);
      },
    });
  }

  const showProgress = processing || imageStatuses.some((s) => s !== "pending");
  const thumbnails = images.map((img) => img.previewUrl);
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
    setResults((prev) => prev.filter((r) => r !== undefined && r.index !== index));
  }

  // Flatten sparse results array for display
  const displayResults = (results as (ProcessResultItem | undefined)[])
    .map((r) => r ?? undefined)
    .filter((r): r is ProcessResultItem => r !== undefined);

  return (
    <>
    <Header />
    <main className="min-h-screen bg-stone-50 dark:bg-stone-950">
      <div className="max-w-5xl mx-auto p-6 md:p-10">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-stone-900 dark:text-stone-100">Image Studio</h1>
          <p className="text-sm text-stone-500 dark:text-stone-400 mt-1">
            Upload product images, choose a brand preset, apply the style.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="md:col-span-2 space-y-4">
            <Uploader onImagesAdded={addImages} />

            {images.length > 0 && (
              <div className="space-y-2">
                {images.map((img) => (
                  <QueueItem
                    key={img.id}
                    image={img}
                    role={roles[img.id] || "hero"}
                    onRoleChange={changeRole}
                    onRemove={removeImage}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="space-y-5">
            <div className="bg-white dark:bg-stone-900 p-4 rounded-2xl border border-stone-200 dark:border-stone-800">
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
                  placeholder="ex: colocar num pano de veludo preto, iluminação dramática, ângulo lateral, foco nos cristais. Podes escrever em PT ou EN."
                  rows={5}
                  className="w-full px-3 py-2 border border-stone-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-stone-400"
                />
                <p className="text-xs text-stone-400 mt-1">
                  Esta instrução é adicionada ao estilo base do preset. Combina
                  as duas coisas para manter consistência de marca com controlo
                  por produto.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleProcess}
              disabled={processing || images.length === 0}
              className="w-full bg-indigo-600 text-white py-3 rounded-xl font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {processing
                ? `A processar…`
                : `Processar ${images.length} imagem${images.length === 1 ? "" : "s"}`}
            </button>

            {error && (
              <div className="text-sm bg-red-50 border border-red-200 text-red-700 rounded p-3">
                {error}
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

        <Results
          originals={images}
          results={displayResults}
          presetId={selectedPresetId}
          collection={selectedCollection}
          onRegenerate={handleRegenerate}
          onDiscard={handleDiscard}
        />
      </div>
    </main>
    </>
  );
}
