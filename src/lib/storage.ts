import fs from "fs";
import path from "path";
import crypto from "crypto";

const IMAGES_DIR = path.join(process.cwd(), "data", "images");

function ensureDir() {
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
}

function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/webp": ".webp",
    "image/avif": ".avif",
  };
  return map[mime.toLowerCase()] ?? ".png";
}

export function generateId(): string {
  return crypto.randomUUID();
}

export function saveImage(base64: string, mime: string, prefix: string): string {
  ensureDir();
  const ext = extFromMime(mime);
  const filename = `${prefix}${ext}`;
  const filePath = path.join(IMAGES_DIR, filename);
  fs.writeFileSync(filePath, Buffer.from(base64, "base64"));
  return filename;
}

export function readImage(filename: string): { buffer: Buffer; mime: string } | null {
  const filePath = path.join(IMAGES_DIR, filename);
  if (!fs.existsSync(filePath)) return null;

  const buffer = fs.readFileSync(filePath);
  const ext = path.extname(filename).toLowerCase();
  const mimeMap: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".avif": "image/avif",
  };
  return { buffer, mime: mimeMap[ext] ?? "image/png" };
}

export function deleteImage(filename: string): void {
  const filePath = path.join(IMAGES_DIR, filename);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}
