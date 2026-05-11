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

export const DEFAULT_TRANSLATION_MODEL = "nano-banana-2";

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
  return `Your task: translate EVERY visible piece of text in this product image into natural, well-written ${langName}.

WHERE TO LOOK FOR TEXT — translate text in ALL of these locations:
- On the main product (book covers, packaging, labels, tags, stickers)
- On banners, callouts, badges, ribbons, price tags
- Inside ANY phone screen, tablet screen, laptop screen, or device mockup shown in the image
- On printed materials (boxes, leaflets, instructions, posters) visible in the scene
- Any caption, headline, subtitle, tagline, bullet point, or body copy

WHAT TO TRANSLATE — translate aggressively:
- Product titles ("Carpal Tunnel Recovery Blueprint" → translate it)
- Marketing taglines ("THE AT-HOME", "Simple, Effective Strategies", "Best Seller")
- Headlines, subtitles, descriptions, instructions
- Generic English phrases of any kind
- If the same text appears in TWO places (e.g. on the product AND on a phone-screen mockup), translate BOTH instances identically

WHAT TO KEEP UNCHANGED — only these:
- Numerals and digits (2024, 50%, 3X, etc.)
- Currency symbols and prices ($19.99, £29, €15)
- URLs, email addresses, @handles, hashtags
- SKU/product codes
- Real registered company brand names ONLY (e.g. Nike, Apple, Sony, Shopify). A product name or descriptive phrase is NOT a brand — translate it.

VISUAL RULES — the rest of the image must stay PIXEL-PERFECT:
- Same product, same pose, same materials, same colours
- Same background, lighting, shadows, perspective and composition
- Same fonts, font weights, colours, strokes and drop-shadows on each text block
- Same positioning and alignment of each text element
- If a translation is longer than the original, shrink the type proportionally so it fits the same area — DO NOT move or reflow other elements
- Do not add new text, watermarks, logos or stickers that were not there before
- Do not redraw or restyle the product

EDGE CASES:
- If the image contains zero readable text, return it completely unchanged
- If text is partly cut off or stylised, still translate the readable portion
- Preserve ALL CAPS / Title Case / lowercase styling per text block

Output ONLY the edited image — no captions, no annotations, no extra text in the response.`;
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
