"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import Header from "@/components/Header";

// ---------- Types ----------

interface ShotPreset {
  type: string;
  preset: {
    label: string;
    needsCharacter: boolean;
    suggestedPrompt: string;
  };
}

interface ModelInfo {
  slug: string;
  displayName: string;
  description: string;
  supportsEditing: boolean;
  supportsMultiImage: boolean;
  creditsPerImage: number;
}

interface SlotRow {
  shotType: string;
  modelSlug: string;
  prompt: string;
}

interface StoreInfo {
  id: string;
  name: string;
  character_reference_url: string | null;
  character_description: string | null;
  gallery_default_count: number;
  is_active: boolean;
}

// ---------- Component ----------

function ConfigureInner() {
  const router = useRouter();

  // Data from sessionStorage
  const [selectedHandles, setSelectedHandles] = useState<string[]>([]);
  const [sourceStore, setSourceStore] = useState("");

  // API data
  const [shotPresets, setShotPresets] = useState<ShotPreset[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [activeStore, setActiveStore] = useState<StoreInfo | null>(null);

  // Gallery template
  const [slots, setSlots] = useState<SlotRow[]>([]);

  // Character reference upload
  const [uploading, setUploading] = useState(false);

  // Submission
  const [creating, setCreating] = useState(false);

  // ---------- Load data ----------

  useEffect(() => {
    // Load selected products from sessionStorage
    const raw = sessionStorage.getItem("galleryConfig");
    if (!raw) {
      router.push("/scan");
      return;
    }
    try {
      const data = JSON.parse(raw) as { handles: string[]; sourceStore: string };
      setSelectedHandles(data.handles);
      setSourceStore(data.sourceStore);
    } catch {
      router.push("/scan");
    }
  }, [router]);

  useEffect(() => {
    // Fetch shot presets, models, and active store in parallel
    Promise.all([
      fetch("/api/shot-presets").then((r) => r.json()),
      fetch("/api/models?editing=true").then((r) => r.json()),
      fetch("/api/stores").then((r) => r.json()),
    ]).then(([presetsData, modelsData, storesData]) => {
      const presets = presetsData.presets as ShotPreset[];
      setShotPresets(presets);
      setModels(modelsData.models as ModelInfo[]);

      const stores = (storesData.stores ?? []) as StoreInfo[];
      const active = stores.find((s) => s.is_active) ?? null;
      setActiveStore(active);

      // Initialize default slots from shot presets
      const defaultCount = active?.gallery_default_count ?? 4;
      const defaultTypes = ["hero", "detail_macro", "in_hand", "in_box"];
      const initialSlots: SlotRow[] = [];
      for (let i = 0; i < Math.min(defaultCount, defaultTypes.length); i++) {
        const type = defaultTypes[i];
        const preset = presets.find((p) => p.type === type);
        const needsChar = type === "in_hand" || type === "on_model";
        initialSlots.push({
          shotType: type,
          modelSlug: needsChar ? "nano-banana-pro" : "nano-banana-edit",
          prompt: preset?.preset.suggestedPrompt ?? "",
        });
      }
      // Fill remaining with hero if defaultCount > defaultTypes
      for (let i = initialSlots.length; i < defaultCount; i++) {
        const preset = presets.find((p) => p.type === "lifestyle");
        initialSlots.push({
          shotType: "lifestyle",
          modelSlug: "nano-banana-edit",
          prompt: preset?.preset.suggestedPrompt ?? "",
        });
      }
      setSlots(initialSlots);
    }).catch(() => {
      toast.error("Failed to load configuration data");
    });
  }, []);

  // ---------- Slot handlers ----------

  const updateSlot = useCallback(
    (idx: number, field: keyof SlotRow, value: string) => {
      setSlots((prev) => {
        const next = [...prev];
        next[idx] = { ...next[idx], [field]: value };

        // Auto-fill prompt and set recommended model when shot type changes
        if (field === "shotType") {
          const preset = shotPresets.find((p) => p.type === value);
          if (preset) {
            next[idx].prompt = preset.preset.suggestedPrompt;
          }
          // Character shots → nano-banana-pro (multi-image), others → nano-banana-edit
          const needsCharacter = value === "in_hand" || value === "on_model";
          next[idx].modelSlug = needsCharacter ? "nano-banana-pro" : "nano-banana-edit";
        }
        return next;
      });
    },
    [shotPresets]
  );

  function addSlot() {
    if (slots.length >= 10) return;
    const preset = shotPresets.find((p) => p.type === "lifestyle");
    setSlots((prev) => [
      ...prev,
      {
        shotType: "lifestyle",
        modelSlug: "nano-banana-edit",
        prompt: preset?.preset.suggestedPrompt ?? "",
      },
    ]);
  }

  function removeSlot(idx: number) {
    if (slots.length <= 1) return;
    setSlots((prev) => prev.filter((_, i) => i !== idx));
  }

  // ---------- Character reference ----------

  async function handleCharacterUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !activeStore) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch(
        `/api/stores/${activeStore.id}/character-reference`,
        { method: "POST", body: formData }
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Upload failed");
        return;
      }
      setActiveStore((prev) =>
        prev ? { ...prev, character_reference_url: data.url } : prev
      );
      toast.success("Character reference uploaded");
    } catch {
      toast.error("Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleCharacterRemove() {
    if (!activeStore) return;
    try {
      await fetch(`/api/stores/${activeStore.id}/character-reference`, {
        method: "DELETE",
      });
      setActiveStore((prev) =>
        prev ? { ...prev, character_reference_url: null } : prev
      );
      toast.success("Character reference removed");
    } catch {
      toast.error("Failed to remove");
    }
  }

  // ---------- Generate All ----------

  async function handleGenerateAll() {
    if (slots.length === 0 || selectedHandles.length === 0) return;

    // Warn if character-needing slots exist but no reference
    const needsChar = slots.some((s) => {
      const preset = shotPresets.find((p) => p.type === s.shotType);
      return preset?.preset.needsCharacter;
    });
    if (needsChar && !activeStore?.character_reference_url) {
      toast.error(
        "Some slots need a character reference but none is uploaded. Upload one or change the shot types."
      );
      return;
    }

    setCreating(true);
    try {
      const res = await fetch("/api/gallery/create-job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_store: sourceStore,
          selected_handles: selectedHandles,
          gallery_template: slots.map((s) => ({
            shot_type: s.shotType,
            model_slug: s.modelSlug,
            prompt: s.prompt,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to create job");
        return;
      }
      router.push(`/jobs/${data.jobId}`);
    } catch {
      toast.error("Network error");
    } finally {
      setCreating(false);
    }
  }

  // ---------- Cost estimate ----------

  const totalImages = selectedHandles.length * slots.length;
  const totalCredits = slots.reduce((sum, s) => {
    const m = models.find((x) => x.slug === s.modelSlug);
    return sum + (m?.creditsPerImage ?? 4);
  }, 0) * selectedHandles.length;
  const estimatedCost = (totalCredits * 0.01).toFixed(2);
  const estimatedMinutes = Math.ceil(totalImages * 0.5); // ~30s per image

  // Per-model breakdown
  const modelBreakdown = new Map<string, { name: string; slots: number; credits: number }>();
  for (const s of slots) {
    const m = models.find((x) => x.slug === s.modelSlug);
    const key = s.modelSlug;
    const existing = modelBreakdown.get(key);
    if (existing) {
      existing.slots += selectedHandles.length;
      existing.credits += (m?.creditsPerImage ?? 4) * selectedHandles.length;
    } else {
      modelBreakdown.set(key, {
        name: m?.displayName ?? key,
        slots: selectedHandles.length,
        credits: (m?.creditsPerImage ?? 4) * selectedHandles.length,
      });
    }
  }

  // ---------- Render ----------

  if (selectedHandles.length === 0) {
    return <p className="text-sm text-stone-500 text-center py-16">Loading...</p>;
  }

  return (
    <div className="space-y-6 pb-24">
      {/* Character Reference Card */}
      <section className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl p-5">
        <h2 className="text-sm font-semibold text-stone-500 dark:text-stone-400 uppercase tracking-wider mb-3">
          Character Reference
        </h2>
        {activeStore?.character_reference_url ? (
          <div className="flex items-center gap-4">
            <img
              src={activeStore.character_reference_url}
              alt="Character reference"
              className="w-16 h-16 rounded-lg object-cover border border-stone-200 dark:border-stone-700"
            />
            <div className="flex-1">
              <p className="text-sm text-stone-700 dark:text-stone-300">
                Reference for <strong>{activeStore.name}</strong>
              </p>
              <p className="text-xs text-stone-400 mt-0.5">
                Used in "in hand" and "on model" shots
              </p>
            </div>
            <div className="flex gap-2">
              <label className="text-xs px-3 py-1.5 border border-stone-300 dark:border-stone-600 text-stone-600 dark:text-stone-300 rounded cursor-pointer hover:border-stone-500">
                Replace
                <input
                  type="file"
                  accept="image/jpeg,image/png"
                  onChange={handleCharacterUpload}
                  className="hidden"
                />
              </label>
              <button
                onClick={handleCharacterRemove}
                className="text-xs px-3 py-1.5 text-red-600 dark:text-red-400 hover:text-red-800"
              >
                Remove
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-lg bg-stone-100 dark:bg-stone-800 border-2 border-dashed border-stone-300 dark:border-stone-600 flex items-center justify-center">
              <svg
                className="w-6 h-6 text-stone-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                />
              </svg>
            </div>
            <div className="flex-1">
              <p className="text-sm text-stone-600 dark:text-stone-400">
                No character reference set for{" "}
                <strong>{activeStore?.name ?? "active store"}</strong>
              </p>
              <p className="text-xs text-stone-400 mt-0.5">
                Upload a photo to use in "in hand" and "on model" shots
              </p>
            </div>
            <label className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded cursor-pointer hover:bg-indigo-700">
              {uploading ? "Uploading..." : "Upload"}
              <input
                type="file"
                accept="image/jpeg,image/png"
                onChange={handleCharacterUpload}
                disabled={uploading}
                className="hidden"
              />
            </label>
          </div>
        )}
      </section>

      {/* Gallery Template */}
      <section className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-stone-500 dark:text-stone-400 uppercase tracking-wider">
            Gallery Template
          </h2>
          <span className="text-xs text-stone-400">
            {slots.length} slot{slots.length !== 1 ? "s" : ""} per product
          </span>
        </div>

        <div className="space-y-3">
          {slots.map((slot, idx) => {
            const preset = shotPresets.find((p) => p.type === slot.shotType);
            const needsChar = preset?.preset.needsCharacter ?? false;

            return (
              <div
                key={idx}
                className="border border-stone-200 dark:border-stone-700 rounded-xl p-3 space-y-2"
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-stone-400 w-5 text-center">
                    {idx + 1}
                  </span>

                  {/* Shot Type */}
                  <select
                    value={slot.shotType}
                    onChange={(e) => updateSlot(idx, "shotType", e.target.value)}
                    className="text-sm px-2 py-1.5 border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 rounded flex-shrink-0"
                  >
                    {shotPresets.map((p) => (
                      <option key={p.type} value={p.type}>
                        {p.preset.label}
                      </option>
                    ))}
                  </select>

                  {/* Model */}
                  <select
                    value={slot.modelSlug}
                    onChange={(e) =>
                      updateSlot(idx, "modelSlug", e.target.value)
                    }
                    className="text-sm px-2 py-1.5 border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 rounded flex-shrink-0"
                  >
                    {models.map((m) => {
                      const isRecommended = needsChar
                        ? m.slug === "nano-banana-pro"
                        : m.slug === "nano-banana-edit";
                      return (
                        <option key={m.slug} value={m.slug}>
                          {m.displayName} ({m.creditsPerImage}cr){isRecommended ? " \u2713" : ""}
                        </option>
                      );
                    })}
                  </select>

                  {/* Badges */}
                  {needsChar && (
                    <span className="text-[10px] bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 px-1.5 py-0.5 rounded flex-shrink-0">
                      Uses character ref
                    </span>
                  )}

                  <div className="flex-1" />

                  {/* Remove */}
                  {slots.length > 1 && (
                    <button
                      onClick={() => removeSlot(idx)}
                      className="text-stone-400 hover:text-red-500 text-xs"
                      title="Remove slot"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>

                {/* Prompt */}
                <textarea
                  value={slot.prompt}
                  onChange={(e) => updateSlot(idx, "prompt", e.target.value)}
                  rows={2}
                  className="w-full text-xs px-3 py-2 border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 text-stone-700 dark:text-stone-300 rounded-lg resize-none focus:outline-none focus:ring-1 focus:ring-indigo-400"
                  placeholder="Prompt for this shot..."
                />
              </div>
            );
          })}

          {/* Add slot */}
          {slots.length < 10 && (
            <button
              onClick={addSlot}
              className="w-full py-2 text-xs text-stone-500 dark:text-stone-400 border border-dashed border-stone-300 dark:border-stone-600 rounded-xl hover:border-stone-500 hover:text-stone-700 dark:hover:text-stone-200 transition-colors"
            >
              + Add slot
            </button>
          )}
        </div>
      </section>

      {/* Cost Summary */}
      <section className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl p-5">
        <h2 className="text-sm font-semibold text-stone-500 dark:text-stone-400 uppercase tracking-wider mb-3">
          Summary
        </h2>
        <div className="grid grid-cols-3 gap-4 text-center mb-4">
          <div>
            <p className="text-2xl font-semibold text-stone-900 dark:text-stone-100">
              {totalImages}
            </p>
            <p className="text-xs text-stone-400">
              {selectedHandles.length} products x {slots.length} slots
            </p>
          </div>
          <div>
            <p className="text-2xl font-semibold text-stone-900 dark:text-stone-100">
              {totalCredits}
            </p>
            <p className="text-xs text-stone-400">credits (~${estimatedCost})</p>
          </div>
          <div>
            <p className="text-2xl font-semibold text-stone-900 dark:text-stone-100">
              ~{estimatedMinutes}m
            </p>
            <p className="text-xs text-stone-400">estimated time</p>
          </div>
        </div>
        {modelBreakdown.size > 1 && (
          <div className="border-t border-stone-100 dark:border-stone-800 pt-3 space-y-1">
            {[...modelBreakdown.values()].map((b) => (
              <div key={b.name} className="flex justify-between text-xs text-stone-500 dark:text-stone-400">
                <span>{b.slots} images x {b.name}</span>
                <span>{b.credits} credits</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Sticky footer */}
      <div className="fixed bottom-0 left-0 right-0 bg-white/95 dark:bg-stone-950/95 backdrop-blur border-t border-stone-200 dark:border-stone-800 shadow-lg z-40">
        <div className="max-w-3xl mx-auto px-6 md:px-10 py-3 flex items-center justify-between">
          <div className="text-sm text-stone-600 dark:text-stone-400">
            <strong>{selectedHandles.length}</strong> product{selectedHandles.length !== 1 ? "s" : ""},{" "}
            <strong>{slots.length}</strong> image{slots.length !== 1 ? "s" : ""} each
          </div>
          <div className="flex gap-3">
            <Link
              href="/scan"
              className="text-sm border border-stone-300 dark:border-stone-600 text-stone-600 dark:text-stone-300 px-4 py-2 rounded-lg hover:border-stone-500"
            >
              Back
            </Link>
            <button
              onClick={handleGenerateAll}
              disabled={creating || slots.length === 0}
              className="text-sm bg-indigo-600 text-white px-6 py-2.5 rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              {creating ? "Creating job..." : `Generate ${totalImages} Images`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ConfigurePage() {
  return (
    <>
      <Header />
      <main className="min-h-screen bg-stone-50 dark:bg-stone-950">
        <div className="max-w-3xl mx-auto p-6 md:p-10">
          <Link
            href="/scan"
            className="text-sm text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200 mb-3 inline-block"
          >
            &larr; Back to scan
          </Link>
          <h1 className="text-2xl font-semibold text-stone-900 dark:text-stone-100 mb-1">
            Configure Gallery
          </h1>
          <p className="text-sm text-stone-500 dark:text-stone-400 mb-6">
            Set up image slots for each product. Every product gets the same template.
          </p>
          <Suspense
            fallback={
              <div className="text-center py-16 text-stone-500 text-sm">
                Loading...
              </div>
            }
          >
            <ConfigureInner />
          </Suspense>
        </div>
      </main>
    </>
  );
}
