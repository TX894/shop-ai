import { complete } from "./anthropic-client";

const LANG_NAMES: Record<string, string> = {
  pt: "Portuguese (European)",
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  it: "Italian",
};

export async function translateText(
  text: string,
  targetLang: string
): Promise<string> {
  if (!text.trim()) return text;
  const langName = LANG_NAMES[targetLang] ?? targetLang;
  return complete(
    `You are a professional e-commerce translator. Translate the following product text to ${langName}. Keep the tone professional and suitable for a luxury online store. Output ONLY the translation, nothing else. Preserve any HTML tags.`,
    text,
    { temperature: 0.2 }
  );
}

export async function enhanceTitle(
  title: string,
  language: string,
  productType?: string
): Promise<string> {
  if (!title.trim()) return title;
  const langName = LANG_NAMES[language] ?? language;
  const typeHint = productType ? ` (product type: ${productType})` : "";
  return complete(
    `You are an expert luxury e-commerce copywriter. Rewrite this product title to be more appealing and SEO-friendly for a premium online store. Keep it under 80 characters. Write in ${langName}. Output ONLY the new title, nothing else.`,
    `${title}${typeHint}`,
    { temperature: 0.7, maxTokens: 128 }
  );
}

export async function enhanceDescription(
  html: string,
  title: string,
  language: string
): Promise<string> {
  if (!html.trim()) {
    return complete(
      `You are an expert luxury e-commerce copywriter writing in ${LANG_NAMES[language] ?? language}. Create a short, elegant product description with 2-3 bullet points. Output clean HTML (<p> and <ul><li> tags). Nothing else.`,
      `Product: ${title}`,
      { temperature: 0.7, maxTokens: 512 }
    );
  }
  const langName = LANG_NAMES[language] ?? language;
  return complete(
    `You are an expert luxury e-commerce copywriter. Rewrite this product description to be more compelling for a premium store. Structure it with a short intro paragraph and 3-5 bullet points highlighting key features. Write in ${langName}. Output clean HTML (<p> and <ul><li> tags). Nothing else.`,
    `Product: ${title}\n\nCurrent description:\n${html}`,
    { temperature: 0.7, maxTokens: 512 }
  );
}
