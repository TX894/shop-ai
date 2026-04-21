"use client";

import { useRef, useState } from "react";

export interface UploadedImage {
  id: string;
  file: File;
  base64: string;
  mimeType: string;
  previewUrl: string;
}

interface UploaderProps {
  onImagesAdded: (images: UploadedImage[]) => void;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1];
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default function Uploader({ onImagesAdded }: UploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  async function handleFiles(fileList: FileList | null) {
    if (!fileList) return;
    const images: UploadedImage[] = [];
    for (const file of Array.from(fileList)) {
      if (!file.type.startsWith("image/")) continue;
      const base64 = await fileToBase64(file);
      images.push({
        id: `${Date.now()}-${Math.random()}`,
        file,
        base64,
        mimeType: file.type,
        previewUrl: URL.createObjectURL(file),
      });
    }
    if (images.length > 0) onImagesAdded(images);
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        handleFiles(e.dataTransfer.files);
      }}
      onClick={() => inputRef.current?.click()}
      className={`border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition ${
        dragging
          ? "border-stone-800 bg-stone-100"
          : "border-stone-300 hover:border-stone-500 bg-white"
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/*"
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      <p className="text-stone-600">
        Arrasta imagens aqui ou clica para selecionar
      </p>
      <p className="text-stone-400 text-sm mt-1">
        JPG, PNG, WebP — até 20MB cada
      </p>
    </div>
  );
}
