/**
 * Pre-scraped product payload sent from the bookmarklet / Chrome extension.
 * Same shape the /import-external page passes to /api/import/external.
 */
export interface ExternalProduct {
  title: string;
  descriptionHtml: string;
  vendor?: string;
  productType?: string;
  /** Raw numeric price from the source page, in source currency. */
  priceOriginal?: string;
  /** Currency symbol or ISO code from the source ($, €, USD, etc.). */
  priceCurrency?: string;
  /** Direct URLs to the product images, in display order. */
  imageUrls: string[];
  /** The URL the bookmarklet was launched from (e.g. the Temu PDP). */
  sourceUrl: string;
  /** Human-readable brand of the source site (e.g. "Temu", "AliExpress"). */
  sourceBrand: string;
  /** Optional handle suggestion — Shopify will dedupe if taken. */
  handle?: string;
}

export interface ExternalImportOptions {
  language: string;
  translateEnabled?: boolean;
  translateImagesEnabled?: boolean;
  translateImagesModel?: string;
  enhanceTitleEnabled?: boolean;
  enhanceDescriptionEnabled?: boolean;
  seoEnabled?: boolean;
  aiImagesEnabled?: boolean;
  aiImagePresetId?: string;
  aiImageCollection?: string;
  aiImageCustomPrompt?: string;
  imageModel?: string;
  maxImages?: number;
  watermarkEnabled?: boolean;
  watermarkPosition?: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center" | "bottom-strip";
  watermarkOpacity?: number;
  watermarkSize?: number;
  tags?: string[];
  collectionIds?: string[];
  pricingMode?: "original" | "fixed" | "markup";
  fixedPrice?: string;
  markupPercent?: number;
  productStatus?: "DRAFT" | "ACTIVE";
  publishMode?: "online-store" | "all" | "none";
}

export interface ExternalImportRequest {
  product: ExternalProduct;
  options: ExternalImportOptions;
}

export interface ExternalImportEvent {
  type: "step" | "product-done" | "product-error" | "complete";
  step?: string;
  progress?: { current: number; total: number };
  result?: { shopifyProductId: string; adminUrl: string };
  error?: string;
  productTitle?: string;
}
