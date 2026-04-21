"use client";

import type { Preset } from "@/types/preset";

interface PresetSelectorProps {
  presets: Preset[];
  selectedId: string;
  onChange: (id: string) => void;
  selectedCollection: string;
  onCollectionChange: (key: string) => void;
}

export default function PresetSelector({
  presets,
  selectedId,
  onChange,
  selectedCollection,
  onCollectionChange,
}: PresetSelectorProps) {
  const current = presets.find((p) => p.id === selectedId);
  const collectionKeys = current
    ? Object.keys(current.collection_presets)
    : [];

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-stone-700 mb-1">
          Preset de marca
        </label>
        <select
          value={selectedId}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-3 py-2 border border-stone-300 rounded bg-white focus:outline-none focus:ring-2 focus:ring-stone-400"
        >
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {current && (
          <p className="text-xs text-stone-500 mt-1">{current.description}</p>
        )}
      </div>

      {collectionKeys.length > 0 && (
        <div>
          <label className="block text-sm font-medium text-stone-700 mb-1">
            Coleção
          </label>
          <select
            value={selectedCollection}
            onChange={(e) => onCollectionChange(e.target.value)}
            className="w-full px-3 py-2 border border-stone-300 rounded bg-white focus:outline-none focus:ring-2 focus:ring-stone-400"
          >
            {collectionKeys.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
