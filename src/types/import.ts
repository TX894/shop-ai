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
  imageModel?: string;
  /** Translate every visible text in each product image into `language`. */
  translateImagesEnabled?: boolean;
  /** Model slug used for image-text translation. Defaults to nano-banana-2. */
  translateImagesModel?: string;
  /** Max number of source images to import per product. Defaults to 20 (Shopify supports up to 250 per product, but we cap to fit Vercel runtime). */
  maxImages?: number;
  /** Generate SEO bundle (meta title, meta description, handle, tags, alt text) for each product. */
  seoEnabled?: boolean;
  /** Stamp the active store's logo/brand onto every imported image. Critical for Shopify-policy safety when working from third-party photography. */
  watermarkEnabled?: boolean;
  /** Position of the watermark on each image. */
  watermarkPosition?: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center" | "bottom-strip";
  /** 0..1 opacity. */
  watermarkOpacity?: number;
  /** Watermark width as a fraction of the image width (0.05–0.5). */
  watermarkSize?: number;
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
