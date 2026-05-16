/**
 * Helper to load the active store's brand context for AI calls + watermarking.
 * Centralised so import + jobs + preview routes can share the same logic.
 */

import { getActiveStore } from "./stores";
import type { StoreContext } from "./translation-service";

export interface ActiveStoreBundle {
  ctx: StoreContext;
  logoUrl: string | null;
  brandShortName: string | null;
  storeName: string;
}

export async function loadActiveStoreContext(): Promise<StoreContext | undefined> {
  const bundle = await loadActiveStoreBundle();
  return bundle?.ctx;
}

export async function loadActiveStoreBundle(): Promise<ActiveStoreBundle | undefined> {
  try {
    const store = await getActiveStore();
    if (!store) return undefined;
    return {
      storeName: store.name,
      logoUrl: store.logo_url,
      brandShortName: store.brand_short_name ?? store.name,
      ctx: {
        storeName: store.name,
        brandBrief: store.brand_brief,
        niche: store.niche,
        targetAudience: store.target_audience,
        brandVoice: store.brand_voice,
        valueProps: store.value_props,
        replaceBrandWith: store.brand_short_name ?? store.name,
      },
    };
  } catch {
    return undefined;
  }
}
