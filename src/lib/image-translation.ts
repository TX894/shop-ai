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

BRAND REPLACEMENT — TOP PRIORITY:
Any text that looks like a competitor / third-party brand or trademark MUST be REPLACED with "${replaceBrandWith}".
This includes:
- Words ending with ™ or ®
- Stylised wordmarks rendered as their own typography (e.g. "Treatmedy™", "Treatmedy", "OrthoFix", "BunionPro", "Neckmedy", "Orthomedy")
- Proprietary product names ("Treatmedy™ Bunion Fix", "Neckmedy Pain Relief Device", "OrthoGloves") — the brand-name part becomes "${replaceBrandWith}", the descriptor (Bunion Fix / Pain Relief Device / Gloves) gets translated
- Any "Why X Is Different", "Powered by X", "By X Inc.", "X Innovation" callouts
- Brand text engraved, printed, or stamped on the actual product surface (3D-rendered text, curved type, embossed/debossed lettering, logos screened onto fabric / metal / plastic)
- Brand text inside any device mockup, phone screen, packaging panel or marketing hero

Replace them in-place, in the same font style, colour, perspective and position as the original. Use exactly "${replaceBrandWith}" — same casing, same spelling. Drop any ™ or ® that came with the competitor mark.

DO NOT preserve competitor brand names anywhere in the output. If you see "Treatmedy" five times, it must become "${replaceBrandWith}" five times. The store importing these images owns the listing — the original brand must not appear in the output, including in subtle places like product surfaces or rendered 3D objects.`
    : `

BRAND PRESERVATION:
Real registered company brand names (Nike, Apple, Sony) stay verbatim. Product names and descriptive phrases are NOT brand names — translate them.`;

  return `Your task: translate EVERY visible piece of text in this product image into natural, well-written ${langName}, and rewrite ALL competitor-brand wordmarks. Translation is mandatory wherever text is readable — do not skip text just because it looks "baked into" the photo.${brandReplacementBlock}

WHERE TO LOOK FOR TEXT — exhaustive checklist, scan ALL of these surfaces:
- On the main product surface (engraved, printed, embossed, stamped, screen-printed, sublimated). This includes text that follows curves of a 3D object, runs along straps, sits on fabric, sits on metal/plastic housings, or appears at any angle/perspective. Curved/3D-rendered text counts.
- Logos and wordmarks that look like part of the product photo — these are NOT decoration, they ARE text that must be translated/replaced.
- Packaging panels, boxes, sleeves, hangtags, care labels, instruction inserts.
- Marketing overlays: callouts, badges, ribbons, price tags, "NEW" stickers, sale flags.
- Phone screens, tablet screens, laptop screens, device mockups, kiosk displays.
- Headlines, subtitles, descriptions, instructions, bullet points, body copy anywhere in the scene.
- Watermarks, captions, copyright lines, social handles.

WHAT TO TRANSLATE — be aggressive, default to translating:
- Product titles (e.g. "Carpal Tunnel Recovery Blueprint", "Bunion Fix") → translate
- Marketing taglines ("THE AT-HOME", "Why Treatmedy Is Different", "Simple, Effective Strategies", "Best Seller", "100% Natural") → translate
- Feature labels — ALWAYS translate, even if they sit inside circular badges, on infographic panels, or on the product itself ("ADVANCED ALIGNMENT THERAPY", "SOFT BUNION PADDING", "PATENTED HINGE JOINT MECHANISM", "ADJUSTABLE STRETCH", "PAIN-FREE REALIGNMENT", "PREMIUM DURABLE MATERIALS") → translate every one
- If the same text appears in TWO places (e.g. on the product AND on a callout panel), translate BOTH instances identically. Never leave one English copy behind.

WHAT TO KEEP UNCHANGED (the only exceptions):
- Numerals and digits (2024, 50%, 3X, etc.)
- Currency symbols and prices ($19.99, £29, €15)
- URLs, email addresses, @handles, hashtags
- SKU/product codes

VISUAL RULES — the rest of the image must stay PIXEL-PERFECT:
- Same product, same pose, same materials, same colours, same 3D geometry
- Same background, lighting, shadows, perspective and composition
- Same fonts, font weights, colours, strokes and drop-shadows on each text block
- Same positioning and alignment of each text element — even when text wraps a curved surface, the translation must follow the same curve
- If a translation is longer than the original, shrink the type proportionally so it fits the same area — DO NOT move or reflow other elements, DO NOT crop other elements
- Do not add new text, watermarks, logos or stickers that were not there before
- Do not redraw or restyle the product

REASONING — before you decide an image needs no edit, ask yourself:
1. Is there ANY text visible? If yes, you almost certainly have work to do.
2. Did I check the product surface itself, not just overlays?
3. Did I check all panels, badges, and screens in the scene?
4. Did I replace every competitor brand mark, including ones rendered as 3D / curved / on-product?

EDGE CASES:
- If the image truly contains zero readable text (e.g. a clean product cutout with no labels at all), return it unchanged.
- If text is partly cut off or stylised, still translate the readable portion.
- Preserve ALL CAPS / Title Case / lowercase styling per text block.
- Stylised brand wordmarks are STILL text — translate / replace them. Do not treat them as decoration.

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
