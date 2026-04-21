import crypto from "crypto";

function useBlob(): boolean {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
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

/**
 * Returns a Blob URL (production) or local filename (dev).
 * In production (Vercel), BLOB_READ_WRITE_TOKEN must be set — filesystem is read-only.
 *
 * IMPORTANT: The Vercel Blob Store MUST be created with **public** access.
 * Private stores require authenticated reads (token-signed URLs) which break
 * direct <img src=""> usage in the UI and Shopify product images.
 * You cannot change a store's access mode after creation.
 */
export async function saveImage(base64: string, mime: string, prefix: string): Promise<string> {
  if (useBlob()) {
    const { put } = await import("@vercel/blob");
    const ext = extFromMime(mime);
    const filename = `${prefix}${ext}`;
    const buffer = Buffer.from(base64, "base64");
    try {
      const blob = await put(filename, buffer, {
        access: "public",
        contentType: mime,
      });
      return blob.url;
    } catch (err) {
      if (err instanceof Error && err.message.includes("public access on a private store")) {
        throw new Error(
          "Blob store is private but must be public. " +
          "Create a new PUBLIC Blob Store in Vercel Dashboard > Storage, " +
          "then reconnect its token. Private stores cannot be changed to public."
        );
      }
      throw err;
    }
  }

  // Detect Vercel serverless (read-only filesystem) without Blob configured
  if (process.env.VERCEL) {
    throw new Error(
      "Image upload failed: BLOB_READ_WRITE_TOKEN is not set. " +
      "Add it via Vercel Dashboard > Storage > Connect Blob Store."
    );
  }

  // Local filesystem (dev only)
  const fs = await import("fs");
  const path = await import("path");
  const IMAGES_DIR = path.join(process.cwd(), "data", "images");
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
  const ext = extFromMime(mime);
  const filename = `${prefix}${ext}`;
  fs.writeFileSync(path.join(IMAGES_DIR, filename), Buffer.from(base64, "base64"));
  return filename;
}

/** Read image — returns buffer for local files, or fetches from Blob URL */
export async function readImage(pathOrUrl: string): Promise<{ buffer: Buffer; mime: string } | null> {
  // Blob URL
  if (pathOrUrl.startsWith("https://")) {
    try {
      const res = await fetch(pathOrUrl);
      if (!res.ok) return null;
      const buffer = Buffer.from(await res.arrayBuffer());
      const mime = res.headers.get("content-type") || "image/png";
      return { buffer, mime };
    } catch {
      return null;
    }
  }

  // Local file
  const fs = await import("fs");
  const path = await import("path");
  const IMAGES_DIR = path.join(process.cwd(), "data", "images");
  const filePath = path.join(IMAGES_DIR, pathOrUrl);
  if (!fs.existsSync(filePath)) return null;

  const buffer = fs.readFileSync(filePath);
  const ext = path.extname(pathOrUrl).toLowerCase();
  const mimeMap: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".avif": "image/avif",
  };
  return { buffer, mime: mimeMap[ext] ?? "image/png" };
}

export async function deleteImage(pathOrUrl: string): Promise<void> {
  if (pathOrUrl.startsWith("https://")) {
    try {
      const { del } = await import("@vercel/blob");
      await del(pathOrUrl);
    } catch { /* ignore */ }
    return;
  }

  const fs = await import("fs");
  const path = await import("path");
  const IMAGES_DIR = path.join(process.cwd(), "data", "images");
  const filePath = path.join(IMAGES_DIR, pathOrUrl);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}
