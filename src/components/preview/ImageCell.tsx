"use client";

import { useState } from "react";
import type { PreviewImage } from "./types";

interface ImageCellProps {
  image: PreviewImage;
  index: number;
  total: number;
  onApprove: () => void;
  onReject: () => void;
  onDiscard: () => void;
  onMoveLeft: () => void;
  onMoveRight: () => void;
  onZoom: () => void;
  onRegenerate: (prompt: string) => void;
  regenerating?: boolean;
}

const ROLE_COLORS: Record<string, string> = {
  hero: "bg-indigo-100 text-indigo-700",
  detail: "bg-amber-100 text-amber-700",
  lifestyle: "bg-emerald-100 text-emerald-700",
};

export default function ImageCell({
  image,
  index,
  total,
  onApprove,
  onReject,
  onDiscard,
  onMoveLeft,
  onMoveRight,
  onZoom,
  onRegenerate,
  regenerating,
}: ImageCellProps) {
  const [showRegen, setShowRegen] = useState(false);
  const [regenPrompt, setRegenPrompt] = useState(image.prompt ?? "");

  const hasImage = !!image.resultBase64;
  const imgSrc = hasImage
    ? `data:${image.resultMime};base64,${image.resultBase64}`
    : image.originalUrl;

  return (
    <div className="relative group">
      {/* Main image */}
      <div
        className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-colors ${
          image.approved
            ? "border-emerald-400"
            : "border-stone-200"
        }`}
      >
        {regenerating ? (
          <div className="w-full h-full bg-stone-100 flex items-center justify-center">
            <div className="w-8 h-8 border-3 border-stone-200 border-t-indigo-600 rounded-full animate-spin" />
          </div>
        ) : (
          <img
            src={imgSrc}
            alt={image.role}
            className={`w-full h-full object-cover cursor-pointer ${!image.approved ? "opacity-60" : ""}`}
            onClick={onZoom}
          />
        )}

        {/* Approve checkbox */}
        <button
          onClick={(e) => { e.stopPropagation(); image.approved ? onReject() : onApprove(); }}
          className="absolute top-2 left-2 z-10"
          aria-label={image.approved ? "Reject image" : "Approve image"}
        >
          <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
            image.approved ? "bg-emerald-500 border-emerald-500" : "bg-white/80 border-stone-300 hover:border-stone-500"
          }`}>
            {image.approved && (
              <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            )}
          </div>
        </button>

        {/* Role badge */}
        <span className={`absolute top-2 right-2 text-[9px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded ${ROLE_COLORS[image.role] ?? "bg-stone-100 text-stone-600"}`}>
          {image.role}
        </span>

        {/* AI badge */}
        {image.aiGenerated && (
          <span className="absolute bottom-2 left-2 text-[9px] font-medium bg-indigo-500 text-white px-1.5 py-0.5 rounded">
            AI
          </span>
        )}

        {/* Error badge */}
        {image.error && (
          <div className="absolute bottom-2 left-2 right-2 text-[9px] bg-amber-100/90 text-amber-700 px-1.5 py-0.5 rounded truncate">
            {image.error}
          </div>
        )}

        {/* Hover actions */}
        {!regenerating && (
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
            <button
              onClick={(e) => { e.stopPropagation(); onZoom(); }}
              className="bg-white/90 hover:bg-white rounded-full w-8 h-8 flex items-center justify-center text-stone-700 text-sm"
              aria-label="Zoom"
            >
              ⤢
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setShowRegen(!showRegen); setRegenPrompt(image.prompt ?? ""); }}
              className="bg-white/90 hover:bg-white rounded-full w-8 h-8 flex items-center justify-center text-stone-700 text-sm"
              aria-label="Regenerate"
            >
              ↻
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onDiscard(); }}
              className="bg-white/90 hover:bg-red-50 rounded-full w-8 h-8 flex items-center justify-center text-rose-600 text-sm"
              aria-label="Discard"
            >
              ×
            </button>
          </div>
        )}
      </div>

      {/* Move buttons */}
      <div className="flex items-center justify-center gap-1 mt-1.5">
        <button
          onClick={onMoveLeft}
          disabled={index === 0}
          className="text-[10px] text-stone-400 hover:text-stone-700 disabled:opacity-30 disabled:cursor-not-allowed px-1.5 py-0.5 rounded hover:bg-stone-100"
          aria-label="Move left"
        >
          ←
        </button>
        {/* Version tabs */}
        {image.versions && image.versions.length > 0 && (
          <div className="flex gap-0.5">
            {image.versions.map((_, vi) => (
              <span key={vi} className={`text-[8px] px-1 py-0.5 rounded ${vi === image.currentVersion - 1 ? "bg-stone-200 text-stone-600" : "text-stone-400"}`}>
                v{vi + 1}
              </span>
            ))}
            <span className="text-[8px] px-1 py-0.5 rounded bg-indigo-100 text-indigo-600">
              v{(image.versions?.length ?? 0) + 1}
            </span>
          </div>
        )}
        <button
          onClick={onMoveRight}
          disabled={index === total - 1}
          className="text-[10px] text-stone-400 hover:text-stone-700 disabled:opacity-30 disabled:cursor-not-allowed px-1.5 py-0.5 rounded hover:bg-stone-100"
          aria-label="Move right"
        >
          →
        </button>
      </div>

      {/* Regenerate inline */}
      {showRegen && (
        <div className="mt-2 bg-stone-50 border border-stone-200 rounded-lg p-2 space-y-2">
          <textarea
            value={regenPrompt}
            onChange={(e) => setRegenPrompt(e.target.value)}
            rows={3}
            className="w-full text-[11px] font-mono px-2 py-1.5 border border-stone-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400"
            placeholder="Edit prompt and regenerate..."
          />
          <div className="flex gap-1.5">
            <button
              onClick={() => { onRegenerate(regenPrompt); setShowRegen(false); }}
              disabled={!regenPrompt.trim()}
              className="text-[11px] bg-indigo-600 text-white px-3 py-1 rounded hover:bg-indigo-700 disabled:opacity-50"
            >
              Regenerate
            </button>
            <button
              onClick={() => setShowRegen(false)}
              className="text-[11px] text-stone-500 hover:text-stone-800 px-2 py-1"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
