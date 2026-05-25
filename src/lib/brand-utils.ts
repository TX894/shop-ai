/**
 * Small helpers for deriving a competitor / supplier brand name from the
 * store domain we are importing from.
 *
 * When we know the exact competitor brand string (e.g. "Treatmedy"), the
 * image-edit prompt can say "change the text that says Treatmedy to SOULAGIS"
 * — a concrete, neutral text-edit instruction. That is far more reliable
 * than asking the model to "replace any competitor trademark", which trips
 * Gemini's brand/trademark safety filters and makes it silently no-op.
 */

/**
 * Derive a human-readable brand name from a store domain.
 *   treatmedy.com            → "Treatmedy"
 *   www.bunion-pro.com       → "Bunion Pro"
 *   my-store.myshopify.com   → "My Store"
 */
export function deriveBrandName(domain?: string | null): string | null {
  if (!domain) return null;
  const host = domain
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .split("/")[0];
  if (!host) return null;
  // Take the left-most label: "treatmedy" from "treatmedy.com"
  let root = host.split(".")[0];
  // For *.myshopify.com the left label IS the store handle — keep it.
  if (!root) return null;
  // Strip trailing digits sometimes appended to handles
  root = root.replace(/\d+$/, "");
  const words = root
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  const name = words.join(" ").trim();
  return name.length >= 2 ? name : null;
}
