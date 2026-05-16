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

  const brandReplacementBlock = replaceBrandWith
    ? `

BRAND REPLACEMENT — VERY IMPORTANT:
Any text that looks like a competitor / third-party brand or trademark must be REPLACED with "${replaceBrandWith}".
This includes:
- Words ending with ™ or ®
- Stylised wordmarks rendered as their own typography (e.g. "Treatmedy™", "OrthoFix", "BunionPro")
- Repeated proprietary product names ("Treatmedy™ Bunion Fix" → "${replaceBrandWith}")
- Any "Why X Is Different" or "Powered by X" callouts
Replace them in-place, in the same font style, colour and position as the original. Use exactly "${replaceBrandWith}" — same casing, same spelling. Drop any ™ or ® that came with the competitor mark.

DO NOT preserve competitor brand names. The store importing these images owns the listing — the original brand must not appear in the output.`
    : `

BRAND PRESERVATION:
Real registered company brand names (Nike, Apple, Sony) stay verbatim. Product names and descriptive phrases are NOT brand names — translate them.`;

  return `Your task: translate EVERY visible piece of text in this product image into natural, well-written ${langName}.${brandReplacementBlock}

WHERE TO LOOK FOR TEXT — translate text in ALL of these locations:
- On the main product (book covers, packaging, labels, tags, stickers)
- On banners, callouts, badges, ribbons, price tags
- Inside ANY phone screen, tablet screen, laptop screen, or device mockup shown in the image
- On printed materials (boxes, leaflets, instructions, posters) visible in the scene
- Any caption, headline, subtitle, tagline, bullet point, or body copy

WHAT TO TRANSLATE — translate aggressively:
- Product titles (e.g. "Carpal Tunnel Recovery Blueprint" → translate it)
- Marketing taglines ("THE AT-HOME", "Simple, Effective Strategies", "Best Seller")
- Feature labels (e.g. "ADVANCED ALIGNMENT THERAPY", "SOFT BUNION PADDING", "PATENTED HINGE JOINT MECHANISM" — translate these)
- Headlines, subtitles, descriptions, instructions
- Generic English phrases of any kind
- If the same text appears in TWO places (e.g. on the product AND on a phone-screen mockup), translate BOTH instances identically

WHAT TO KEEP UNCHANGED:
- Numerals and digits (2024, 50%, 3X, etc.)
- Currency symbols and prices ($19.99, £29, €15)
- URLs, email addresses, @handles, hashtags
- SKU/product codes

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
  const prompt = buildPrompt(args.targetLang, args.replaceBrandWith);

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
