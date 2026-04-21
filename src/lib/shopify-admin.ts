/**
 * Shopify Admin GraphQL API — product creation + image upload.
 * Uses API version 2025-01.
 */

import { getAccessToken, getStoreDomain } from "./shopify-auth";
import { getItem } from "./db";
import { readImage } from "./storage";

const API_VERSION = "2025-01";

// ---------- Types ----------

export interface ProductDetails {
  title: string;
  descriptionHtml?: string;
  priceGBP?: string;
  vendor?: string;
  productType?: string;
  tags?: string[];
  status?: "DRAFT" | "ACTIVE";
}

export interface PushResult {
  productId: string;
  handle: string;
  adminUrl: string;
  status: string;
  imagesUploaded: number;
}

interface GraphQLResponse<T = Record<string, unknown>> {
  data?: T;
  errors?: { message: string }[];
}

// ---------- GraphQL client ----------

export async function graphql<T = Record<string, unknown>>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const token = await getAccessToken();
  const domain = getStoreDomain();

  const res = await fetchWithRetry(
    `https://${domain}/admin/api/${API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({ query, variables }),
    }
  );

  if (!res.ok) {
    if (res.status === 403) {
      throw new Error(
        "Shopify 403: app needs scopes write_products and write_product_listings"
      );
    }
    throw new Error(`Shopify GraphQL HTTP ${res.status}`);
  }

  const json = (await res.json()) as GraphQLResponse<T>;
  if (json.errors?.length) {
    throw new Error(`Shopify GraphQL: ${json.errors.map((e) => e.message).join("; ")}`);
  }
  if (!json.data) {
    throw new Error("Shopify GraphQL: empty data");
  }
  return json.data;
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  retries = 3
): Promise<Response> {
  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetch(url, init);
    if (res.status === 429) {
      const retryAfter = parseFloat(res.headers.get("Retry-After") ?? "2");
      const delay = Math.min(retryAfter * 1000, 10000) * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }
    return res;
  }
  throw new Error("Shopify rate limit: too many retries");
}

// ---------- Shop query (for test-auth) ----------

export async function queryShop(): Promise<{ name: string; myshopifyDomain: string }> {
  const data = await graphql<{
    shop: { name: string; myshopifyDomain: string };
  }>(`query { shop { name myshopifyDomain } }`);
  return data.shop;
}

// ---------- Product creation ----------

export async function pushProduct(
  libraryItemIds: string[],
  details: ProductDetails,
  onProgress?: (step: string) => void
): Promise<PushResult> {
  // 1. Create product
  onProgress?.("A criar produto...");

  // Step 1: Create product (without variants — not allowed in 2025-01 ProductInput)
  const createData = await graphql<{
    productCreate: {
      product: {
        id: string;
        handle: string;
        status: string;
        variants: { edges: { node: { id: string } }[] };
      } | null;
      userErrors: { field: string[]; message: string }[];
    };
  }>(
    `mutation productCreate($input: ProductInput!) {
      productCreate(input: $input) {
        product {
          id
          handle
          status
          variants(first: 1) {
            edges {
              node {
                id
              }
            }
          }
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      input: {
        title: details.title,
        descriptionHtml: details.descriptionHtml ?? "",
        vendor: details.vendor ?? "",
        productType: details.productType ?? "",
        tags: details.tags ?? [],
        status: details.status ?? "DRAFT",
      },
    }
  );

  const createErrors = createData.productCreate.userErrors;
  if (createErrors.length > 0) {
    throw new Error(
      `Shopify product creation failed: ${createErrors.map((e) => e.message).join("; ")}`
    );
  }

  const product = createData.productCreate.product;
  if (!product) {
    throw new Error("Shopify product creation returned no product");
  }

  const productGid = product.id;

  // Step 2: Set price on the default variant
  const defaultVariantId = product.variants.edges[0]?.node?.id;
  if (defaultVariantId && details.priceGBP) {
    onProgress?.("A definir preço...");

    const variantData = await graphql<{
      productVariantsBulkUpdate: {
        productVariants: { id: string; price: string }[] | null;
        userErrors: { field: string[]; message: string }[];
      };
    }>(
      `mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
          productVariants {
            id
            price
          }
          userErrors {
            field
            message
          }
        }
      }`,
      {
        productId: productGid,
        variants: [{ id: defaultVariantId, price: details.priceGBP }],
      }
    );

    const variantErrors = variantData.productVariantsBulkUpdate.userErrors;
    if (variantErrors.length > 0) {
      console.error(
        "[shopify-admin] Variant price update errors:",
        variantErrors.map((e) => e.message).join("; ")
      );
    }
  }

  // 2. Upload images
  let imagesUploaded = 0;
  for (let i = 0; i < libraryItemIds.length; i++) {
    const itemId = libraryItemIds[i];
    onProgress?.(`A fazer upload da imagem ${i + 1} de ${libraryItemIds.length}...`);

    try {
      await uploadImageToProduct(productGid, itemId);
      imagesUploaded++;
    } catch (err) {
      console.error(
        `[shopify-admin] Image upload failed for ${itemId}:`,
        err instanceof Error ? err.message : err
      );
      // Continue with other images
    }
  }

  const domain = getStoreDomain();
  const numericId = productGid.split("/").pop();
  const adminUrl = `https://${domain}/admin/products/${numericId}`;

  onProgress?.("Pronto!");

  return {
    productId: productGid,
    handle: product.handle,
    adminUrl,
    status: product.status,
    imagesUploaded,
  };
}

// ---------- Image upload (staged upload flow) ----------

async function uploadImageToProduct(
  productGid: string,
  libraryItemId: string
): Promise<void> {
  const item = await getItem(libraryItemId);
  if (!item) throw new Error(`Library item ${libraryItemId} not found`);

  const imageFile = readImage(item.result_path);
  if (!imageFile) throw new Error(`Image file missing for ${libraryItemId}`);

  const filename = item.result_path;
  const mimeType = imageFile.mime;
  const fileSize = imageFile.buffer.length.toString();

  // Step 1: Get staged upload URL
  const stagedData = await graphql<{
    stagedUploadsCreate: {
      stagedTargets: {
        url: string;
        resourceUrl: string;
        parameters: { name: string; value: string }[];
      }[];
      userErrors: { field: string[]; message: string }[];
    };
  }>(
    `mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets {
          url
          resourceUrl
          parameters {
            name
            value
          }
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      input: [
        {
          resource: "PRODUCT_IMAGE",
          filename,
          mimeType,
          fileSize,
          httpMethod: "POST",
        },
      ],
    }
  );

  const stagedErrors = stagedData.stagedUploadsCreate.userErrors;
  if (stagedErrors.length > 0) {
    throw new Error(`Staged upload error: ${stagedErrors.map((e) => e.message).join("; ")}`);
  }

  const target = stagedData.stagedUploadsCreate.stagedTargets[0];
  if (!target) throw new Error("No staged target returned");

  // Step 2: Upload file to staged URL (multipart form)
  const formData = new FormData();
  for (const param of target.parameters) {
    formData.append(param.name, param.value);
  }
  formData.append(
    "file",
    new Blob([new Uint8Array(imageFile.buffer)], { type: mimeType }),
    filename
  );

  const uploadRes = await fetch(target.url, {
    method: "POST",
    body: formData,
  });

  if (!uploadRes.ok) {
    throw new Error(`Staged upload PUT failed: HTTP ${uploadRes.status}`);
  }

  // Step 3: Attach image to product
  const mediaData = await graphql<{
    productCreateMedia: {
      media: { id: string; status: string }[] | null;
      mediaUserErrors: { field: string[]; message: string }[];
    };
  }>(
    `mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
      productCreateMedia(productId: $productId, media: $media) {
        media {
          ... on MediaImage {
            id
            status
          }
        }
        mediaUserErrors {
          field
          message
        }
      }
    }`,
    {
      productId: productGid,
      media: [
        {
          originalSource: target.resourceUrl,
          mediaContentType: "IMAGE",
          alt: item.notes ?? "Product image",
        },
      ],
    }
  );

  const mediaErrors = mediaData.productCreateMedia.mediaUserErrors;
  if (mediaErrors.length > 0) {
    throw new Error(`Media creation error: ${mediaErrors.map((e) => e.message).join("; ")}`);
  }
}
