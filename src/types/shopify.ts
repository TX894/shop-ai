export interface ShopifyImage {
  id: number;
  src: string;
  alt: string | null;
  width: number;
  height: number;
  position: number;
}

export interface ShopifyVariant {
  id: number;
  title: string;
  price: string;
  compare_at_price: string | null;
  available: boolean;
  sku: string;
}

export interface ShopifyProduct {
  id: number;
  handle: string;
  title: string;
  body_html: string;
  vendor: string;
  product_type: string;
  tags: string[];
  variants: ShopifyVariant[];
  images: ShopifyImage[];
}

export interface ScanResponse {
  products: ShopifyProduct[];
  totalCount: number;
  collectionHandle: string | null;
}
