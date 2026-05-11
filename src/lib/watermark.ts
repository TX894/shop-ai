/**
 * Brand-watermark composer.
 *
 * Layers the store's logo (or, as a fallback, a typographic strip with the
 * brand short name) over each imported product image. This is the primary
 * defence against Shopify DMCA / acceptable-use takedowns when working
 * from competitor / supplier photography:
 *
 *   - Adding our own branding makes the work *transformative*.
 *   - Customers see who they're buying from on every PDP image.
 *   - Even if the source brand later files a complaint, the modified
 *     asset is harder to argue is a verbatim copy.
 *
 * The combination of (a) watermark, (b) AI restyle (changing background /
 * lighting), and (c) image-text translation gives us three layers of
 * transformation. Watermark alone is not bullet-proof for trademarked
 * products — pair it with AI restyle for highest safety.
 *
 * Implementation: pure `sharp` — no extra service required.
 */

import sharp from "sharp";

export type WatermarkPosition =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right"
  | "center"
  | "bottom-strip";

export interface WatermarkOptions {
  /** Vercel Blob URL of the brand logo (PNG with alpha recommended). */
  logoUrl?: string | null;
  /** Brand short name (used inside the bottom strip and as text fallback). */
  brandShortName?: string | null;
  /** Where to place the watermark. Defaults to bottom-right. */
  position?: WatermarkPosition;
  /** 0..1 opacity multiplier applied to the logo. Defaults to 0.85. */
  opacity?: number;
  /**
   * Watermark width as a fraction of the source image width.
   * Default 0.16 (16% — visible but not loud).
   */
  size?: number;
}

const DEFAULT_OPACITY = 0.85;
const DEFAULT_SIZE = 0.16;
const DEFAULT_POSITION: WatermarkPosition = "bottom-right";
const PADDING_FRACTION = 0.03; // 3% of image edge

const logoCache = new Map<string, Promise<Buffer>>();

async function fetchLogoBuffer(url: string): Promise<Buffer> {
  let cached = logoCache.get(url);
  if (!cached) {
    cached = (async () => {
      const res = await fetch(url, { cache: "force-cache" });
      if (!res.ok) throw new Error(`Logo fetch failed: HTTP ${res.status}`);
      const arr = await res.arrayBuffer();
      return Buffer.from(arr);
    })();
    logoCache.set(url, cached);
    // Fail-safe: if fetch rejects, drop from cache so retries can succeed
    cached.catch(() => logoCache.delete(url));
  }
  return cached;
}

interface GravityOffset {
  gravity: keyof sharp.GravityEnum | string;
  left?: number;
  top?: number;
}

function positionToGravity(
  pos: WatermarkPosition,
  imgWidth: number,
  imgHeight: number,
  wmWidth: number,
  wmHeight: number
): GravityOffset {
  const padX = Math.round(imgWidth * PADDING_FRACTION);
  const padY = Math.round(imgHeight * PADDING_FRACTION);
  switch (pos) {
    case "top-left":
      return { gravity: "northwest", left: padX, top: padY };
    case "top-right":
      return { gravity: "northeast", left: imgWidth - wmWidth - padX, top: padY };
    case "bottom-left":
      return { gravity: "southwest", left: padX, top: imgHeight - wmHeight - padY };
    case "bottom-right":
    case "bottom-strip":
      return { gravity: "southeast", left: imgWidth - wmWidth - padX, top: imgHeight - wmHeight - padY };
    case "center":
      return {
        gravity: "center",
        left: Math.round((imgWidth - wmWidth) / 2),
        top: Math.round((imgHeight - wmHeight) / 2),
      };
  }
}

/** Build a typographic strip used when no logo is available. */
function buildTextStripSvg(brandName: string, stripWidth: number, stripHeight: number): Buffer {
  const fontSize = Math.round(stripHeight * 0.46);
  // Sanitise — strip everything except letters, numbers, basic punctuation and unicode latin extended
  const safe = brandName.replace(/[<>&"]/g, "").slice(0, 60);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${stripWidth}" height="${stripHeight}" viewBox="0 0 ${stripWidth} ${stripHeight}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="rgba(0,0,0,0)" />
        <stop offset="100%" stop-color="rgba(0,0,0,0.55)" />
      </linearGradient>
    </defs>
    <rect width="${stripWidth}" height="${stripHeight}" fill="url(#bg)" />
    <text x="${stripWidth / 2}" y="${stripHeight * 0.72}" font-family="Helvetica, Arial, sans-serif"
          font-size="${fontSize}" font-weight="700" fill="rgba(255,255,255,0.95)"
          text-anchor="middle" letter-spacing="${Math.round(fontSize * 0.06)}">${safe}</text>
  </svg>`;
  return Buffer.from(svg);
}

export interface ApplyWatermarkInput {
  imageBase64: string;
  mimeType: string;
  options: WatermarkOptions;
}

export interface ApplyWatermarkOutput {
  imageBase64: string;
  mimeType: string;
  applied: boolean;
}

/**
 * Composite the watermark onto a base64-encoded image.
 * Returns the original image unchanged when no logo/brand is configured.
 */
export async function applyWatermark(
  input: ApplyWatermarkInput
): Promise<ApplyWatermarkOutput> {
  const { imageBase64, mimeType, options } = input;
  const { logoUrl, brandShortName } = options;

  // Nothing to apply
  if (!logoUrl && !brandShortName) {
    return { imageBase64, mimeType, applied: false };
  }

  const position = options.position ?? DEFAULT_POSITION;
  const opacity = clamp(options.opacity ?? DEFAULT_OPACITY, 0, 1);
  const sizeFraction = clamp(options.size ?? DEFAULT_SIZE, 0.05, 0.5);

  const sourceBuffer = Buffer.from(imageBase64, "base64");
  const sourceImage = sharp(sourceBuffer);
  const sourceMeta = await sourceImage.metadata();
  const imgWidth = sourceMeta.width ?? 0;
  const imgHeight = sourceMeta.height ?? 0;
  if (!imgWidth || !imgHeight) {
    return { imageBase64, mimeType, applied: false };
  }

  // BOTTOM STRIP — typographic, full width, semi-transparent
  if (position === "bottom-strip" && brandShortName) {
    const stripHeight = Math.max(48, Math.round(imgHeight * 0.085));
    const stripSvg = buildTextStripSvg(brandShortName, imgWidth, stripHeight);
    const composited = await sourceImage
      .composite([{ input: stripSvg, gravity: "south" }])
      .png()
      .toBuffer();
    return {
      imageBase64: composited.toString("base64"),
      mimeType: "image/png",
      applied: true,
    };
  }

  // LOGO-DRIVEN watermark
  let logoBuffer: Buffer | null = null;
  try {
    if (logoUrl) {
      const raw = await fetchLogoBuffer(logoUrl);
      const targetWidth = Math.round(imgWidth * sizeFraction);
      // Resize + apply opacity by lowering the alpha channel
      const alpha = Math.round(255 * opacity);
      logoBuffer = await sharp(raw)
        .ensureAlpha()
        .resize({ width: targetWidth, withoutEnlargement: false })
        .composite([
          {
            input: Buffer.from([0, 0, 0, alpha]),
            raw: { width: 1, height: 1, channels: 4 },
            tile: true,
            blend: "dest-in",
          },
        ])
        .png()
        .toBuffer();
    }
  } catch (logoErr) {
    console.warn(`[watermark] Logo fetch/resize failed: ${logoErr instanceof Error ? logoErr.message : logoErr} — falling back to text strip.`);
    logoBuffer = null;
  }

  // Fallback: no usable logo → render a small text badge
  if (!logoBuffer && brandShortName) {
    const badgeWidth = Math.round(imgWidth * sizeFraction * 1.6);
    const badgeHeight = Math.max(36, Math.round(badgeWidth * 0.34));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${badgeWidth}" height="${badgeHeight}" viewBox="0 0 ${badgeWidth} ${badgeHeight}">
      <rect width="${badgeWidth}" height="${badgeHeight}" rx="${badgeHeight / 2}" fill="rgba(0,0,0,${0.55 * opacity})" />
      <text x="${badgeWidth / 2}" y="${badgeHeight * 0.66}" font-family="Helvetica, Arial, sans-serif"
            font-size="${Math.round(badgeHeight * 0.46)}" font-weight="700"
            fill="rgba(255,255,255,${opacity})" text-anchor="middle" letter-spacing="1">${brandShortName.replace(/[<>&"]/g, "").slice(0, 40)}</text>
    </svg>`;
    logoBuffer = Buffer.from(svg);
  }

  if (!logoBuffer) {
    return { imageBase64, mimeType, applied: false };
  }

  // Get watermark dimensions to compute gravity offsets
  const wmMeta = await sharp(logoBuffer).metadata();
  const wmWidth = wmMeta.width ?? Math.round(imgWidth * sizeFraction);
  const wmHeight = wmMeta.height ?? Math.round(wmWidth * 0.4);

  const offset = positionToGravity(position, imgWidth, imgHeight, wmWidth, wmHeight);

  const composited = await sourceImage
    .composite([{ input: logoBuffer, gravity: offset.gravity as keyof sharp.GravityEnum }])
    .png()
    .toBuffer();

  return {
    imageBase64: composited.toString("base64"),
    mimeType: "image/png",
    applied: true,
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
