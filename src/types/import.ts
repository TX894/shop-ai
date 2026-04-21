export interface ImportOptions {
  sourceStore: string;
  language: string;
  translateEnabled: boolean;
  enhanceTitleEnabled: boolean;
  enhanceDescriptionEnabled: boolean;
  aiImagesEnabled: boolean;
  aiImagePresetId?: string;
  aiImageCollection?: string;
  aiImageCustomPrompt?: string;
  tags: string[];
  collectionIds: string[];
  pricingMode: "original" | "fixed" | "markup";
  fixedPrice?: string;
  markupPercent?: number;
  productStatus: "DRAFT" | "ACTIVE";
  selectedHandles: string[];
}

export interface ImportProductEvent {
  type: "product-start" | "step" | "product-done" | "product-error" | "complete";
  productHandle?: string;
  productTitle?: string;
  step?: string;
  progress?: { current: number; total: number };
  result?: { shopifyProductId: string; adminUrl: string };
  error?: string;
  summary?: { total: number; success: number; failed: number };
}
