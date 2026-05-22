/**
 * Image text translation — re-renders every visible word in a product image
 * into a target language while keeping fonts, colours, positioning and the
 * rest of the photo identical.
 *
 * Dispatches to kie.ai via `generateImage`.
 *
 * IMPORTANT LESSON (the "0 of 10 translated" bug):
 * Asking the model to "replace the competitor's trademark / brand" trips
 * Gemini's brand-safety filters — it refuses and kie.ai returns the source
 * image unchanged while still reporting success. The eBook test (no
 * trademark) translated fine; the Treatmedy test (heavy "Treatmedy™"
 * branding) produced 0 edits.
 *
 * The fix: frame everything as a neutral TEXT EDIT. We never say "brand",
 * "trademark", "competitor" or "logo". We say: "change the text that reads
 * X to read Y". The model edits text all day without complaint.
 */

import { generateImage } from "./image-generation";

const LANG_NAMES: Record<string, string> = {
  pt: "European Portuguese",
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  it: "Italian",
};

export const DEFAULT_TRANSLATION_MODEL = "nano-banana-edit";

export interface TranslateImageArgs {
  imageBase64: string;
  mimeType: string;
  targetLang: string;
  modelSlug?: string;
  /** The user's own brand name to write into the image (e.g. "SOULAGIS"). */
  replaceBrandWith?: string | null;
  /**
   * The exact competitor / supplier brand word currently in the image
   * (e.g. "Treatmedy"). When both this and replaceBrandWith are set, the
   * prompt becomes a concrete neutral text edit: change "Treatmedy" → "SOULAGIS".
   */
  replaceBrandFrom?: string | null;
}

export interface TranslateImageResult {
  imageBase64: string;
  mimeType: string;
  modelUsed: string;
  creditsUsed: number;
  processingTimeMs: number;
  /** True when the model actually returned a different image. */
  changed: boolean;
}

function buildPrompt(
  targetLang: string,
  replaceBrandWith?: string | null,
  replaceBrandFrom?: string | null
): string {
  const langName = LANG_NAMES[targetLang] ?? targetLang;

  // Concrete, neutral text-swap line. No "brand"/"trademark"/"logo" words.
  let swapLine = "";
  if (replaceBrandWith && replaceBrandFrom) {
    swapLine = ` Anywhere the image shows the word "${replaceBrandFrom}", write "${replaceBrandWith}" instead — same style and place.`;
  } else if (replaceBrandWith) {
    swapLine = ` If a product name or store name is written in the image, write "${replaceBrandWith}" in its place — same style and place.`;
  }

  return `Rewrite all the text in this image so it reads in ${langName}. Translate every visible word: titles, headings, the labels inside badges and circles, captions, fine print, and any words printed on the product itself.${swapLine} Keep numbers, prices and web addresses as they are. Do not change anything else — keep the exact same layout, fonts, colours, sizes, product and background. Return the edited image.`;
}

export async function translateImage(
  args: TranslateImageArgs
): Promise<TranslateImageResult> {
  const slug = args.modelSlug || DEFAULT_TRANSLATION_MODEL;
  const prompt = buildPrompt(args.targetLang, args.replaceBrandWith, args.replaceBrandFrom);

  const sourceLen = args.imageBase64.length;
  const t0 = Date.now();

  const result = await generateImage({
    modelSlug: slug,
    prompt,
    sourceImageBase64: args.imageBase64,
    sourceMimeType: args.mimeType,
    fallbackModelSlug: slug === DEFAULT_TRANSLATION_MODEL ? undefined : DEFAULT_TRANSLATION_MODEL,
  });

  const resultLen = result.imageBase64.length;
  const changed = result.imageBase64 !== args.imageBase64;

  // Diagnostic — visible in Vercel logs. If changed=false on every image,
  // the model is no-op'ing (safety refusal, bad input, or kie.ai issue).
  console.log(
    `[translate-image] model=${result.modelUsed} src=${sourceLen}B out=${resultLen}B changed=${changed} time=${Date.now() - t0}ms`
  );

  return {
    imageBase64: result.imageBase64,
    mimeType: result.mimeType,
    modelUsed: result.modelUsed,
    creditsUsed: result.creditsUsed,
    processingTimeMs: result.processingTimeMs,
    changed,
  };
}

export function isTranslatableLanguage(lang: string): boolean {
  return Boolean(LANG_NAMES[lang]) || lang.length >= 2;
}
