/**
 * Helper to load the active store's brand context for AI calls.
 * Centralised so import + jobs + preview routes can share the same logic.
 */

import { getActiveStore } from "./stores";
import type { StoreContext } from "./translation-service";

export async function loadActiveStoreContext(): Promise<StoreContext | undefined> {
  try {
    const store = await getActiveStore();
    if (!store) return undefined;
    return {
      storeName: store.name,
      brandBrief: store.brand_brief,
      niche: store.niche,
      targetAudience: store.target_audience,
      brandVoice: store.brand_voice,
      valueProps: store.value_props,
    };
  } catch {
    return undefined;
  }
}
