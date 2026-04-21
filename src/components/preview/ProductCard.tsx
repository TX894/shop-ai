"use client";

import { useState } from "react";
import type { PreviewProduct, PreviewAction } from "./types";
import ImageCell from "./ImageCell";
import ImageZoomModal from "./ImageZoomModal";

interface ProductCardProps {
  product: PreviewProduct;
  productIdx: number;
  dispatch: (action: PreviewAction) => void;
  onRegenerate: (productIdx: number, imageIdx: number, prompt: string) => void;
  regeneratingImages: Set<string>;
  language: string;
}

export default function ProductCard({
  product,
  productIdx,
  dispatch,
  onRegenerate,
  regeneratingImages,
  language,
}: ProductCardProps) {
  const [zoomIdx, setZoomIdx] = useState<number | null>(null);

  const approvedCount = product.images.filter((img) => img.approved).length;
  const titleLen = product.title.length;
  const descPlain = product.description.replace(/<[^>]+>/g, "").trim();
  const descLen = descPlain.length;

  const titleColor =
    titleLen > 80 ? "text-rose-500" : titleLen > 64 ? "text-amber-500" : "text-stone-400";
  const descColor =
    descLen > 500 ? "text-rose-500" : descLen > 400 ? "text-amber-500" : "text-stone-400";

  const langBadge = language.toUpperCase();

  return (
    <div className={`bg-white border rounded-xl overflow-hidden transition-colors ${product.included ? "border-stone-200" : "border-stone-100 opacity-60"}`}>
      <div className="flex flex-col lg:flex-row">
        {/* Left — Image gallery */}
        <div className="lg:w-[58%] p-4 border-b lg:border-b-0 lg:border-r border-stone-100">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-stone-500">
              {approvedCount} of {product.images.length} approved
            </span>
            <button
              onClick={() => {
                product.images.forEach((_, ii) => {
                  if (product.images[ii].resultBase64) {
                    dispatch({ type: "APPROVE_IMAGE", productIdx, imageIdx: ii });
                  }
                });
              }}
              className="text-[10px] text-emerald-600 hover:text-emerald-800 underline"
            >
              Approve all
            </button>
          </div>

          {product.images.length === 0 ? (
            <div className="aspect-video bg-stone-50 rounded-lg flex items-center justify-center text-sm text-stone-400">
              No images available
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {product.images.map((img, ii) => (
                <ImageCell
                  key={img.id}
                  image={img}
                  index={ii}
                  total={product.images.length}
                  onApprove={() => dispatch({ type: "APPROVE_IMAGE", productIdx, imageIdx: ii })}
                  onReject={() => dispatch({ type: "REJECT_IMAGE", productIdx, imageIdx: ii })}
                  onDiscard={() => dispatch({ type: "DISCARD_IMAGE", productIdx, imageIdx: ii })}
                  onMoveLeft={() => {
                    if (ii > 0) dispatch({ type: "MOVE_IMAGE", productIdx, fromIdx: ii, toIdx: ii - 1 });
                  }}
                  onMoveRight={() => {
                    if (ii < product.images.length - 1) dispatch({ type: "MOVE_IMAGE", productIdx, fromIdx: ii, toIdx: ii + 1 });
                  }}
                  onZoom={() => setZoomIdx(ii)}
                  onRegenerate={(prompt) => onRegenerate(productIdx, ii, prompt)}
                  regenerating={regeneratingImages.has(`${productIdx}:${ii}`)}
                />
              ))}

              {/* Add image placeholder */}
              <div className="aspect-square rounded-lg border-2 border-dashed border-stone-200 flex flex-col items-center justify-center text-stone-300 cursor-not-allowed" title="Coming soon">
                <span className="text-2xl mb-1">+</span>
                <span className="text-[9px]">Soon</span>
              </div>
            </div>
          )}
        </div>

        {/* Right — Editable fields */}
        <div className="lg:w-[42%] p-4 space-y-4">
          {/* Include toggle */}
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 cursor-pointer">
              <div className={`relative w-9 h-5 rounded-full transition-colors ${product.included ? "bg-emerald-500" : "bg-stone-300"}`} onClick={() => dispatch({ type: "TOGGLE_INCLUDED", productIdx })}>
                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${product.included ? "translate-x-4" : "translate-x-0.5"}`} />
              </div>
              <span className="text-xs text-stone-600">{product.included ? "Included" : "Excluded"}</span>
            </label>
            <span className="text-[10px] bg-stone-100 text-stone-500 px-1.5 py-0.5 rounded">{langBadge}</span>
          </div>

          {/* Title */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-stone-600">Title</label>
              <div className="flex items-center gap-2">
                <span className={`text-[10px] ${titleColor}`}>{titleLen} / 80</span>
                {product.title !== product.originalTitle && (
                  <button
                    onClick={() => dispatch({ type: "RESET_TITLE", productIdx })}
                    className="text-[10px] text-stone-400 hover:text-stone-700"
                    title="Reset to AI-generated"
                  >
                    ↺
                  </button>
                )}
              </div>
            </div>
            <input
              type="text"
              value={product.title}
              onChange={(e) => dispatch({ type: "UPDATE_TITLE", productIdx, title: e.target.value })}
              className="w-full px-3 py-2 border border-stone-200 rounded-lg text-sm text-stone-800 focus:outline-none focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400"
            />
          </div>

          {/* Description */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-stone-600">Description</label>
              <div className="flex items-center gap-2">
                <span className={`text-[10px] ${descColor}`}>{descLen} / 500</span>
                {product.description !== product.originalDescription && (
                  <button
                    onClick={() => dispatch({ type: "RESET_DESCRIPTION", productIdx })}
                    className="text-[10px] text-stone-400 hover:text-stone-700"
                    title="Reset"
                  >
                    ↺
                  </button>
                )}
              </div>
            </div>
            <textarea
              value={descPlain}
              onChange={(e) => dispatch({ type: "UPDATE_DESCRIPTION", productIdx, description: `<p>${e.target.value}</p>` })}
              rows={4}
              className="w-full px-3 py-2 border border-stone-200 rounded-lg text-sm text-stone-700 focus:outline-none focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400 resize-none"
            />
          </div>

          {/* Price */}
          <div>
            <label className="text-xs font-medium text-stone-600 mb-1 block">Price</label>
            <div className="flex items-center gap-1">
              <span className="text-sm text-stone-500">£</span>
              <input
                type="text"
                value={product.price}
                onChange={(e) => dispatch({ type: "UPDATE_PRICE", productIdx, price: e.target.value })}
                className="w-24 px-2 py-1.5 border border-stone-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-indigo-400"
              />
            </div>
          </div>

          {/* Tags */}
          <div>
            <label className="text-xs font-medium text-stone-600 mb-1 block">Tags</label>
            <input
              type="text"
              value={product.tags.join(", ")}
              onChange={(e) => dispatch({
                type: "UPDATE_TAGS",
                productIdx,
                tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean),
              })}
              placeholder="tag1, tag2"
              className="w-full px-3 py-1.5 border border-stone-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-indigo-400"
            />
          </div>
        </div>
      </div>

      {/* Zoom modal */}
      {zoomIdx !== null && (
        <ImageZoomModal
          images={product.images}
          currentIndex={zoomIdx}
          onClose={() => setZoomIdx(null)}
          onNavigate={setZoomIdx}
        />
      )}
    </div>
  );
}
