import { complete } from "./anthropic-client";

const LANG_NAMES: Record<string, string> = {
  pt: "Portuguese (European)",
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  it: "Italian",
};

/**
 * Store-level brand & SEO intelligence threaded into every AI call.
 * Anything that's null/empty is skipped from the prompt.
 */
export interface StoreContext {
  storeName?: string | null;
  brandBrief?: string | null;
  niche?: string | null;
  targetAudience?: string | null;
  brandVoice?: string | null;
  valueProps?: string | null;
  /**
   * The user's own brand short name (e.g. "SOULAGIS"). When set, any
   * competitor brand / trademark word that appears in source titles or
   * descriptions is rewritten to this name. Essential for dropshipping
   * where source copy contains the supplier's own brand.
   */
  replaceBrandWith?: string | null;
}

function buildStoreContextBlock(ctx?: StoreContext): string {
  if (!ctx) return "";
  const parts: string[] = [];
  if (ctx.storeName) parts.push(`Store: ${ctx.storeName}`);
  if (ctx.brandBrief) parts.push(`What we sell: ${ctx.brandBrief}`);
  if (ctx.niche) parts.push(`Niche: ${ctx.niche}`);
  if (ctx.targetAudience) parts.push(`Target audience: ${ctx.targetAudience}`);
  if (ctx.brandVoice) parts.push(`Brand voice: ${ctx.brandVoice}`);
  if (ctx.valueProps) parts.push(`Differentiators: ${ctx.valueProps}`);
  if (!parts.length && !ctx.replaceBrandWith) return "";

  const replacement = ctx.replaceBrandWith
    ? `\n\nBRAND REPLACEMENT — VERY IMPORTANT:
- The source copy is from a competitor / supplier and may contain THEIR brand name (e.g. "Treatmedy", "OrthoFix", "BunionPro", words ending in ™ or ®, stylised proprietary product names).
- REPLACE every occurrence of a third-party brand with "${ctx.replaceBrandWith}". Use exactly that spelling and casing. Drop ™ / ® that came with the original.
- A generic descriptor like "Bunion Corrector" is NOT a brand — keep it (translated). Only proprietary marks get replaced.
- Never output the original competitor brand in the result.`
    : "";

  const contextBlock = parts.length
    ? `\n\nSTORE BRAND CONTEXT (use this in every output — match the voice, lean on these differentiators, write FOR this audience):\n${parts.map((p) => `- ${p}`).join("\n")}`
    : "";

  return `${contextBlock}${replacement}\n`;
}

// ──────────────────────────────────────────────────────────────────────
// Pure translation (text fields, not images)
// ──────────────────────────────────────────────────────────────────────

export async function translateText(
  text: string,
  targetLang: string,
  ctx?: StoreContext
): Promise<string> {
  if (!text.trim()) return text;
  const langName = LANG_NAMES[targetLang] ?? targetLang;
  const ctxBlock = buildStoreContextBlock(ctx);
  return complete(
    `You are a senior e-commerce translator for high-converting Shopify stores. Translate the user's product copy into ${langName}, keeping a natural, native tone (not a literal word-for-word). Match the brand voice. Preserve HTML tags. Output ONLY the translation — no commentary, no quotes around it.${ctxBlock}`,
    text,
    { temperature: 0.2 }
  );
}

// ──────────────────────────────────────────────────────────────────────
// Title rewriting — SEO-aware
// ──────────────────────────────────────────────────────────────────────

export async function enhanceTitle(
  title: string,
  language: string,
  productType?: string,
  ctx?: StoreContext
): Promise<string> {
  if (!title.trim()) return title;
  const langName = LANG_NAMES[language] ?? language;
  const ctxBlock = buildStoreContextBlock(ctx);
  const typeHint = productType ? `\nProduct category: ${productType}` : "";

  const system = `You are an e-commerce copywriter who has scaled multiple 7-figure DTC brands. Rewrite the product title to MAXIMISE click-through-rate in Shopify search + Google Shopping.

HARD CONSTRAINTS:
- 50–70 characters total (ideal for SERP and Shopify product pages)
- Write in ${langName}, native speaker tone (never a literal translation)
- Front-load the most search-worthy benefit or product type
- One clear unique-selling-point or differentiator
- No hype words ("AMAZING", "BEST EVER"), no emojis, no ALL CAPS
- Title Case in English; sentence case in other languages
- NO trailing punctuation
- NO brand name unless the source title had one
- Output ONLY the new title — nothing else, no quotes${ctxBlock}`;

  return complete(system, `${title}${typeHint}`, { temperature: 0.55, maxTokens: 120 });
}

// ──────────────────────────────────────────────────────────────────────
// Description rewriting — long-form SEO + conversion structure
// ──────────────────────────────────────────────────────────────────────

export async function enhanceDescription(
  html: string,
  title: string,
  language: string,
  ctx?: StoreContext
): Promise<string> {
  const langName = LANG_NAMES[language] ?? language;
  const ctxBlock = buildStoreContextBlock(ctx);

  const system = `You are an e-commerce copywriter who has scaled multiple 7-figure DTC brands. Write a Shopify product description that converts cold traffic.

STRUCTURE (output exactly this shape, in clean HTML):

<p><strong>One-line hook</strong> — the strongest emotional benefit, ≤14 words. No hype, no fluff.</p>

<p>2–4 sentences of body copy that paint the transformation: who it's for, the problem it solves, why this product is different. Front-load benefits, leave specs for bullets.</p>

<h3>Key features</h3>
<ul>
  <li><strong>Feature name</strong> — benefit-led explanation. 4–6 bullets.</li>
</ul>

<h3>What's included</h3>
<p>Concise list of items the customer receives.</p>

<p><em>One short closing line — reassurance, guarantee, or call to imagine using the product.</em></p>

HARD CONSTRAINTS:
- Language: ${langName}, native speaker tone
- 150–280 words total, scannable
- Bullets must lead with the BENEFIT, then the feature (not the reverse)
- Mention the target customer once if it strengthens conversion
- Naturally weave in keywords from the title and product category for SEO — never keyword-stuff
- Clean HTML only: <p>, <h3>, <ul>, <li>, <strong>, <em>. No inline styles, no classes, no <div>, no <br>
- No emojis, no exclamation marks except in the hook (max 1), no ALL CAPS
- No fake claims, no medical promises, no superlatives without proof
- Output ONLY the HTML body — nothing else, no commentary${ctxBlock}`;

  if (!html.trim()) {
    return complete(system, `Product: ${title}\n\n(No source description provided — write a great one from scratch using the title and store context.)`, {
      temperature: 0.65,
      maxTokens: 900,
    });
  }
  const plain = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return complete(
    system,
    `Product: ${title}\n\nCurrent description (source — rewrite, don't just translate):\n${plain}`,
    { temperature: 0.6, maxTokens: 900 }
  );
}

// ──────────────────────────────────────────────────────────────────────
// SEO meta + handle + tags suggestions in one pass
// ──────────────────────────────────────────────────────────────────────

export interface SeoBundle {
  metaTitle: string;
  metaDescription: string;
  handle: string;
  tags: string[];
  altText: string;
}

export async function generateSeoBundle(
  title: string,
  descriptionHtml: string,
  language: string,
  ctx?: StoreContext
): Promise<SeoBundle | null> {
  const langName = LANG_NAMES[language] ?? language;
  const ctxBlock = buildStoreContextBlock(ctx);
  const plain = descriptionHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

  const system = `You are an e-commerce SEO specialist. Output one JSON object — nothing else, no markdown fence, no commentary. The schema:

{
  "metaTitle": "string, 50–60 chars, ${langName}, includes primary keyword early",
  "metaDescription": "string, 140–160 chars, ${langName}, sells the click — benefit + differentiator + soft CTA, no trailing period if it fits",
  "handle": "string, lowercase, ASCII only, kebab-case, ≤60 chars, no stopwords",
  "tags": ["array of 5–10 lowercase tags useful for Shopify collections and search; mix product-type, material, audience, occasion, style"],
  "altText": "string, ${langName}, ≤120 chars, descriptive image alt text for the hero image, useful for Google Images + accessibility"
}${ctxBlock}`;

  const user = `Title: ${title}\n\nDescription: ${plain.slice(0, 1200)}`;

  const raw = await complete(system, user, { temperature: 0.4, maxTokens: 600 });
  try {
    // Strip any accidental markdown fences just in case
    const cleaned = raw.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
    const parsed = JSON.parse(cleaned) as SeoBundle;
    if (typeof parsed.metaTitle !== "string") return null;
    return parsed;
  } catch (err) {
    console.warn("[seo-bundle] JSON parse failed:", err instanceof Error ? err.message : err, "raw:", raw.slice(0, 300));
    return null;
  }
}
