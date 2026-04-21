"use client";

import { useEffect, useState } from "react";
import type { ImageStatus } from "@/lib/process-stream";

interface ProgressBarProps {
  thumbnails: string[];
  statuses: ImageStatus[];
  startTime: number; // Date.now() when processing began
}

const DEFAULT_SECS_PER_IMAGE = 25;

export default function ProgressBar({
  thumbnails,
  statuses,
  startTime,
}: ProgressBarProps) {
  // Tick every second to keep the countdown live between SSE events
  const [, setTick] = useState(0);
  const total = statuses.length;
  const completed = statuses.filter((s) => s === "done" || s === "error").length;
  const allDone = completed === total && total > 0;

  useEffect(() => {
    if (allDone) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [allDone]);

  const processingIndex = statuses.findIndex((s) => s === "processing");
  const progressPct = total > 0 ? Math.round((completed / total) * 100) : 0;

  // Time estimate
  let estimatedLabel = "";
  if (!allDone && startTime > 0) {
    const elapsed = Date.now() - startTime;
    const avgMs =
      completed > 0
        ? elapsed / completed
        : DEFAULT_SECS_PER_IMAGE * 1000;
    const remainingSecs = Math.max(
      1,
      Math.round(((total - completed) * avgMs) / 1000)
    );
    estimatedLabel = `~${remainingSecs}s restantes`;
  }

  const isSingle = total === 1;

  return (
    <div className="bg-white border border-stone-200 rounded-lg p-4 mb-6">
      {/* Header row */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-stone-700">
          {allDone
            ? `${completed} de ${total} ${total === 1 ? "imagem concluída" : "imagens concluídas"}`
            : isSingle
            ? "A processar…"
            : processingIndex >= 0
            ? `A processar imagem ${processingIndex + 1} de ${total}`
            : "A preparar…"}
        </span>
        {!allDone && estimatedLabel && (
          <span className="text-xs text-stone-400">{estimatedLabel}</span>
        )}
      </div>

      {/* Progress bar */}
      <div className="h-1.5 bg-stone-100 rounded-full overflow-hidden mb-4">
        <div
          className="h-full bg-stone-800 rounded-full transition-all duration-500"
          style={{ width: `${allDone ? 100 : progressPct}%` }}
        />
      </div>

      {/* Single image: spinner */}
      {isSingle && !allDone && (
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 border-2 border-stone-200 border-t-stone-800 rounded-full animate-spin" />
          <span className="text-xs text-stone-500">{estimatedLabel || "A processar…"}</span>
        </div>
      )}

      {/* Multiple images: thumbnail strip */}
      {!isSingle && (
        <div className="flex gap-2 flex-wrap">
          {statuses.map((status, i) => (
            <div key={i} className="relative">
              <div
                className={`w-12 h-12 rounded border-2 overflow-hidden transition-colors ${
                  status === "done"
                    ? "border-stone-800"
                    : status === "error"
                    ? "border-red-400"
                    : status === "processing"
                    ? "border-stone-400"
                    : "border-stone-200"
                }`}
              >
                {thumbnails[i] ? (
                  <img
                    src={thumbnails[i]}
                    alt={`img ${i + 1}`}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-stone-100" />
                )}
              </div>

              {/* Status badge */}
              <div
                className={`absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center ${
                  status === "done"
                    ? "bg-stone-800"
                    : status === "error"
                    ? "bg-red-500"
                    : status === "processing"
                    ? "bg-stone-500 animate-pulse"
                    : "bg-stone-300"
                }`}
              >
                {status === "done" && (
                  <svg
                    className="w-2.5 h-2.5 text-white"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={3}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
                {status === "error" && (
                  <svg
                    className="w-2.5 h-2.5 text-white"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={3}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                )}
                {status === "processing" && (
                  <div className="w-1.5 h-1.5 bg-white rounded-full" />
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
