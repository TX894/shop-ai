"use client";

import { useState } from "react";
import type { ProcessResultItem } from "@/types/preset";
import type { UploadedImage } from "./Uploader";
import { reprocessStream } from "@/lib/process-stream";

interface ResultsProps {
  originals: UploadedImage[];
  results: ProcessResultItem[];
  presetId?: string;
  collection?: string;
  onRegenerate?: (index: number, newResult: ProcessResultItem) => void;
  onDiscard?: (index: number) => void;
}

function downloadBase64(base64: string, mimeType: string, filename: string) {
  const byteChars = atob(base64);
  const byteNumbers = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) {
    byteNumbers[i] = byteChars.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  const blob = new Blob([byteArray], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function Results({
  originals,
  results,
  presetId,
  collection,
  onRegenerate,
  onDiscard,
}: ResultsProps) {
  // Per-card state
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editPrompts, setEditPrompts] = useState<Record<number, string>>({});
  const [regenerating, setRegenerating] = useState<Record<number, boolean>>({});
  const [regenErrors, setRegenErrors] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState<Record<number, boolean>>({});
  const [saved, setSaved] = useState<Record<number, boolean>>({});

  if (results.length === 0) return null;

  function openEdit(r: ProcessResultItem) {
    setEditingIndex(r.index);
    setEditPrompts((prev) => ({
      ...prev,
      [r.index]: prev[r.index] ?? r.prompt ?? "",
    }));
    setRegenErrors((prev) => ({ ...prev, [r.index]: "" }));
  }

  function cancelEdit() {
    setEditingIndex(null);
  }

  async function handleRegenerate(r: ProcessResultItem) {
    const original = originals[r.index];
    if (!original) return;

    const prompt = editPrompts[r.index] ?? r.prompt ?? "";
    setEditingIndex(null);
    setRegenerating((prev) => ({ ...prev, [r.index]: true }));
    setRegenErrors((prev) => ({ ...prev, [r.index]: "" }));

    await reprocessStream(
      original.base64,
      original.mimeType,
      prompt,
      r.index,
      (newResult) => {
        setRegenerating((prev) => ({ ...prev, [r.index]: false }));
        onRegenerate?.(r.index, newResult);
      },
      (message) => {
        setRegenerating((prev) => ({ ...prev, [r.index]: false }));
        setRegenErrors((prev) => ({ ...prev, [r.index]: message }));
      }
    );
  }

  async function handleSave(r: ProcessResultItem) {
    const original = originals[r.index];
    if (!original || !r.imageBase64 || !r.mimeType) return;

    setSaving((prev) => ({ ...prev, [r.index]: true }));
    try {
      const res = await fetch("/api/library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          presetId: presetId ?? "unknown",
          collection: collection ?? "general",
          role: "hero",
          prompt: r.prompt,
          originalBase64: original.base64,
          originalMime: original.mimeType,
          resultBase64: r.imageBase64,
          resultMime: r.mimeType,
        }),
      });
      if (res.ok) {
        setSaved((prev) => ({ ...prev, [r.index]: true }));
      }
    } finally {
      setSaving((prev) => ({ ...prev, [r.index]: false }));
    }
  }

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-medium text-stone-800">Resultados</h2>
      {results.map((r) => {
        const original = originals[r.index];
        const isRegenerating = regenerating[r.index] ?? false;
        const isEditing = editingIndex === r.index;
        const regenError = regenErrors[r.index] ?? "";

        return (
          <div
            key={r.index}
            className="bg-white rounded-lg border border-stone-200 overflow-hidden"
          >
            <div className="grid grid-cols-1 md:grid-cols-2">
              {/* Original */}
              <div className="p-4 border-b md:border-b-0 md:border-r border-stone-200">
                <p className="text-xs uppercase tracking-wide text-stone-500 mb-2">
                  Original
                </p>
                {original && (
                  <img
                    src={original.previewUrl}
                    alt="original"
                    className="w-full rounded"
                  />
                )}
              </div>

              {/* Processed */}
              <div className="p-4">
                <p className="text-xs uppercase tracking-wide text-stone-500 mb-2">
                  Processada
                </p>

                {r.success && r.imageBase64 ? (
                  <>
                    {/* Image with optional regenerating overlay */}
                    <div className="relative">
                      <img
                        src={`data:${r.mimeType};base64,${r.imageBase64}`}
                        alt="processed"
                        className={`w-full rounded transition-opacity ${
                          isRegenerating ? "opacity-30" : ""
                        }`}
                      />
                      {isRegenerating && (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="w-10 h-10 border-4 border-stone-200 border-t-stone-800 rounded-full animate-spin" />
                        </div>
                      )}
                    </div>

                    {/* Action buttons */}
                    {!isRegenerating && !isEditing && (
                      <div className="mt-3 flex items-center gap-2 flex-wrap">
                        <button
                          type="button"
                          onClick={() =>
                            downloadBase64(
                              r.imageBase64!,
                              r.mimeType || "image/png",
                              `processed-${r.index}.png`
                            )
                          }
                          className="text-sm bg-stone-800 text-white px-3 py-1.5 rounded hover:bg-stone-900"
                        >
                          Download
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSave(r)}
                          disabled={saving[r.index] || saved[r.index]}
                          className={`text-sm px-3 py-1.5 rounded border ${
                            saved[r.index]
                              ? "bg-green-50 border-green-300 text-green-700"
                              : "border-stone-300 text-stone-700 hover:border-stone-500 hover:text-stone-900"
                          } disabled:opacity-70`}
                        >
                          {saved[r.index]
                            ? "Guardado"
                            : saving[r.index]
                            ? "A guardar..."
                            : "Guardar"}
                        </button>
                        {onRegenerate && original && (
                          <button
                            type="button"
                            onClick={() => openEdit(r)}
                            className="text-sm border border-stone-300 text-stone-700 px-3 py-1.5 rounded hover:border-stone-500 hover:text-stone-900"
                          >
                            Regenerar
                          </button>
                        )}
                        {onDiscard && (
                          <button
                            type="button"
                            onClick={() => onDiscard(r.index)}
                            className="ml-auto text-xs text-stone-400 hover:text-red-600 px-2 py-1.5 rounded hover:bg-red-50"
                            title="Descartar esta imagem"
                          >
                            <svg
                              className="w-4 h-4"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth={2}
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M6 18L18 6M6 6l12 12"
                              />
                            </svg>
                          </button>
                        )}
                      </div>
                    )}

                    {/* Regen error */}
                    {regenError && (
                      <div className="mt-2 text-xs bg-red-50 border border-red-200 text-red-700 rounded p-2">
                        {regenError}
                      </div>
                    )}
                  </>
                ) : (
                  /* Failed result */
                  <div className="space-y-3">
                    <div className="text-red-700 text-sm bg-red-50 border border-red-200 rounded p-3">
                      {r.error || "Falha desconhecida"}
                    </div>
                    {!isEditing && onRegenerate && original && (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => openEdit(r)}
                          disabled={isRegenerating}
                          className="text-sm border border-stone-300 text-stone-700 px-3 py-1.5 rounded hover:border-stone-500 disabled:opacity-50"
                        >
                          {isRegenerating ? "A regenerar…" : "Tentar novamente"}
                        </button>
                        {onDiscard && (
                          <button
                            type="button"
                            onClick={() => onDiscard(r.index)}
                            className="text-xs text-stone-400 hover:text-red-600 px-2 py-1.5 rounded hover:bg-red-50"
                          >
                            Descartar
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Inline regenerate form */}
            {isEditing && (
              <div className="border-t border-stone-200 p-4 bg-stone-50">
                <label className="block text-xs font-medium text-stone-600 mb-1">
                  Prompt para regenerar (editável):
                </label>
                <textarea
                  value={editPrompts[r.index] ?? ""}
                  onChange={(e) =>
                    setEditPrompts((prev) => ({
                      ...prev,
                      [r.index]: e.target.value,
                    }))
                  }
                  rows={5}
                  className="w-full px-3 py-2 border border-stone-300 rounded text-xs font-mono focus:outline-none focus:ring-2 focus:ring-stone-400 bg-white"
                />
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleRegenerate(r)}
                    disabled={!editPrompts[r.index]?.trim()}
                    className="text-sm bg-stone-800 text-white px-4 py-1.5 rounded hover:bg-stone-900 disabled:opacity-50"
                  >
                    Regenerar
                  </button>
                  <button
                    type="button"
                    onClick={cancelEdit}
                    className="text-sm border border-stone-300 text-stone-600 px-4 py-1.5 rounded hover:border-stone-500"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            {/* Full prompt viewer */}
            {r.prompt && !isEditing && (
              <details className="border-t border-stone-200 p-3 text-xs text-stone-600">
                <summary className="cursor-pointer text-stone-500">
                  Ver prompt usado
                </summary>
                <p className="mt-2 whitespace-pre-wrap font-mono">{r.prompt}</p>
              </details>
            )}
          </div>
        );
      })}
    </div>
  );
}
