/**
 * Image text translation — re-renders every visible word in a product image
 * into a target language while keeping fonts, colours, positioning and the
 * rest of the photo identical.
 *
 * Dispatches to kie.ai via `generateImage`. Default model is
 * `nano-banana-edit` (Gemini 2.5 Flash Image) which is the cheapest editor
 * that does in-place text replacement reasonably well; callers can override
 * with a higher-fidelity slug (e.g. `nano-banana-2`, `flux-kontext-max`).
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
}

export interface TranslateImageResult {
  imageBase64: string;
  mimeType: string;
  modelUsed: string;
  creditsUsed: number;
  processingTimeMs: number;
  /** Indicates whether the model actually changed the image. False when no text was detected. */
  changed: boolean;
}

function buildPrompt(targetLang: string): string {
  const langName = LANG_NAMES[targetLang] ?? targetLang;
  return `Translate every visible piece of text in this product photo into ${langName}.

Hard rules:
- Keep the photo identical apart from the text content. Do not alter the product, lighting, colours, background, layout, perspective, or composition.
- Preserve the original font family, weight, size, colour, stroke, shadow, alignment and positioning of each text block.
- Replace each text element in place. The translated text must occupy the same area as the original.
- If a translation is longer than the original, scale the type proportionally so it still fits the same space — never reflow elements or move other items to make room.
- Keep numbers, prices, currency symbols, SKUs, URLs, brand names and trademarks exactly as they are.
- Do not add new text, captions, banners, watermarks, logos or stickers.
- If the image contains no readable text, return it unchanged.

Output only the edited image.`;
}

export async function translateImage(
  args: TranslateImageArgs
): Promise<TranslateImageResult> {
  const slug = args.modelSlug || DEFAULT_TRANSLATION_MODEL;
  const prompt = buildPrompt(args.targetLang);

  const result = await generateImage({
    modelSlug: slug,
    prompt,
    sourceImageBase64: args.imageBase64,
    sourceMimeType: args.mimeType,
    fallbackModelSlug: slug === DEFAULT_TRANSLATION_MODEL ? undefined : DEFAULT_TRANSLATION_MODEL,
  });

  return {
    imageBase64: result.imageBase64,
    mimeType: result.mimeType,
    modelUsed: result.modelUsed,
    creditsUsed: result.creditsUsed,
    processingTimeMs: result.processingTimeMs,
    changed: result.imageBase64 !== args.imageBase64,
  };
}

export function isTranslatableLanguage(lang: string): boolean {
  return Boolean(LANG_NAMES[lang]) || lang.length >= 2;
}
