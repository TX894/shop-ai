"use client";

import { useEffect, useCallback } from "react";
import type { PreviewImage } from "./types";

interface ImageZoomModalProps {
  images: PreviewImage[];
  currentIndex: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
}

export default function ImageZoomModal({
  images,
  currentIndex,
  onClose,
  onNavigate,
}: ImageZoomModalProps) {
  const image = images[currentIndex];
  if (!image) return null;

  const imgSrc = image.resultUrl
    ? image.resultUrl
    : image.resultBase64
      ? `data:${image.resultMime};base64,${image.resultBase64}`
      : image.originalUrl;

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && currentIndex > 0) onNavigate(currentIndex - 1);
      if (e.key === "ArrowRight" && currentIndex < images.length - 1) onNavigate(currentIndex + 1);
    },
    [onClose, onNavigate, currentIndex, images.length]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div
      className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-6"
      onClick={onClose}
      role="dialog"
      aria-label="Image zoom"
    >
      <div className="relative max-w-3xl w-full max-h-[85vh] flex flex-col items-center" onClick={(e) => e.stopPropagation()}>
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute -top-2 -right-2 z-10 bg-white/90 hover:bg-white rounded-full w-8 h-8 flex items-center justify-center text-stone-700 shadow"
          aria-label="Close"
        >
          ×
        </button>

        {/* Image */}
        <img
          src={imgSrc}
          alt={image.role}
          className="max-h-[75vh] w-auto rounded-lg object-contain"
        />

        {/* Navigation */}
        <div className="flex items-center justify-between w-full mt-4">
          <button
            onClick={() => onNavigate(currentIndex - 1)}
            disabled={currentIndex === 0}
            className="text-white/70 hover:text-white disabled:opacity-30 text-2xl px-4 py-2"
            aria-label="Previous image"
          >
            ←
          </button>
          <div className="text-center">
            <span className="text-white/90 text-sm">
              {image.role} — {currentIndex + 1} of {images.length}
            </span>
            {image.aiGenerated && (
              <span className="ml-2 text-[10px] bg-indigo-500 text-white px-1.5 py-0.5 rounded">AI</span>
            )}
          </div>
          <button
            onClick={() => onNavigate(currentIndex + 1)}
            disabled={currentIndex === images.length - 1}
            className="text-white/70 hover:text-white disabled:opacity-30 text-2xl px-4 py-2"
            aria-label="Next image"
          >
            →
          </button>
        </div>
      </div>
    </div>
  );
}
