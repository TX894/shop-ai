/**
 * Image text translation — re-renders every visible word in a product image
 * into a target language while keeping fonts, colours, positioning and the
 * rest of the photo identical.
 *
 * Dispatches to kie.ai via `generateImage`. Default model is
 * `nano-banana-edit` — chosen back after Nano Banana 2 started returning
 * source-unchanged outputs on dense infographic inputs with a long prompt.
 * Edit is cheaper (4 credits) AND more reliable for this task.
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

// nano-banana-edit (Gemini 2.5 Flash Image) is the most consistent for
// in-place text rewriting on dense infographics. Nano Banana 2 with a long
// system prompt was silently returning source bytes (changed=false on every
// image of a Treatmedy import). Edit ships small, on-task prompts well.
export const DEFAULT_TRANSLATION_MODEL = "nano-banana-edit";

export interface TranslateImageArgs {
  imageBase64: string;
  mimeType: string;
  targetLang: string;
  modelSlug?: string;
  /**
   * The user's own brand name. When set, ANY competitor brand/trademark
   * visible in the image (text or stylised logo) is replaced with this
   * name. Critical for dropshipping — otherwise the model "preserves"
   * Treatmedy/Nike/etc. as if they were legitimate brands to respect.
   */
  replaceBrandWith?: string | null;
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

function buildPrompt(targetLang: string, replaceBrandWith?: string | null): string {
  const langName = LANG_NAMES[targetLang] ?? targetLang;

  // SHORT and DIRECT. Long verbose prompts caused Nano Banana 2 to silently
  // no-op on dense images. This 5-line version performed reliably in testing.
  const brandLine = replaceBrandWith
    ? `Wherever the image shows a brand wordmark (e.g. "Treatmedy", "Treatmedy™", "Neckmedy", "OrthoFix", or any ™/® word), replace it with "${replaceBrandWith}" in the same font, colour and position. Drop the ™ or ®.`
    : `Keep registered brand names verbatim.`;

  return `Translate every visible piece of text in this image into ${langName}. This includes product titles, marketing headlines, feature labels (e.g. "ADVANCED ALIGNMENT THERAPY", "PATENTED HINGE JOINT MECHANISM"), badges, callouts, captions, and any text printed on the product itself or shown inside device mockups. ${brandLine} Keep numbers, prices, URLs and SKUs exactly as they are. The rest of the image must stay pixel-perfect — same product, background, lighting, fonts, colours and layout. Output only the edited image.`;
}

export async function translateImage(
  args: TranslateImageArgs
): Promise<TranslateImageResult> {
  const slug = args.modelSlug || DEFAULT_TRANSLATION_MODEL;
  const prompt = buildPrompt(args.targetLang, args.replaceBrandWith);

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

  // Diagnostic log — surfaces in Vercel logs so we can tell at a glance
  // whether the model did anything. Same input length + same output length
  // + same first chars = strong "no-op" signal.
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
