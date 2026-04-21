"use client";

import type { ImageRole } from "@/types/preset";
import type { UploadedImage } from "./Uploader";

interface QueueItemProps {
  image: UploadedImage;
  role: ImageRole;
  onRoleChange: (id: string, role: ImageRole) => void;
  onRemove: (id: string) => void;
}

const ROLES: ImageRole[] = ["hero", "detail", "lifestyle"];

export default function QueueItem({
  image,
  role,
  onRoleChange,
  onRemove,
}: QueueItemProps) {
  return (
    <div className="flex items-center gap-4 bg-white p-3 rounded border border-stone-200">
      <img
        src={image.previewUrl}
        alt=""
        className="w-20 h-20 object-cover rounded border border-stone-100"
      />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-stone-700 truncate">{image.file.name}</p>
        <div className="mt-2 flex gap-1">
          {ROLES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => onRoleChange(image.id, r)}
              className={`text-xs px-2 py-1 rounded border ${
                role === r
                  ? "bg-stone-800 text-white border-stone-800"
                  : "bg-white text-stone-600 border-stone-300 hover:border-stone-500"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>
      <button
        type="button"
        onClick={() => onRemove(image.id)}
        className="text-stone-400 hover:text-stone-700 text-sm"
      >
        remover
      </button>
    </div>
  );
}
