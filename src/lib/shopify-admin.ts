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
  /** SEO meta title (50-60 chars). Set via productCreate `seo` input. */
  seoTitle?: string;
  /** SEO meta description (140-160 chars). Set via productCreate `seo` input. */
  seoDescription?: string;
  /** URL handle slug. Shopify will dedupe by appending -1, -2 if taken. */
  handle?: string;
  /** Alt text used for ALL uploaded images (override individual notes). */
  imageAltText?: string;
  /**
   * Sales-channel publishing.
   *  - "online-store" (default): publish only to the Online Store channel
   *  - "all": publish to every channel the app has access to (POS, Google, etc.)
   *  - "none": skip publishing (product remains in admin-only)
   */
  publishMode?: "online-store" | "all" | "none";
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
  const domain = await getStoreDomain();

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

// ---------- Sales-channel publication ----------

interface PublicationNode {
  id: string;
  name: string;
}

/**
 * Query all publications (sales channels) the connected app can publish to.
 * Common entries: "Online Store", "Point of Sale", "Google", "Facebook & Instagram".
 */
async function listPublications(): Promise<PublicationNode[]> {
  const data = await graphql<{
    publications: { edges: { node: PublicationNode }[] };
  }>(`query { publications(first: 50) { edges { node { id name } } } }`);
  return data.publications.edges.map((e) => e.node);
}

/**
 * Filter publications according to the chosen mode.
 *  - "online-store": only the Online Store channel (matching name "Online Store")
 *  - "all": every publication returned
 */
function selectPublicationsForMode(
  publications: PublicationNode[],
  mode: "online-store" | "all"
): PublicationNode[] {
  if (mode === "all") return publications;
  return publications.filter((p) => /online\s*store/i.test(p.name));
}

/**
 * Make a product visible on the chosen sales channels.
 * MUST be called after productCreate — otherwise the product is created
 * in admin only and the storefront returns 404 even when status = ACTIVE.
 *
 * Requires the `write_publications` scope on the custom app.
 */
async function publishProductToChannels(
  productGid: string,
  publicationIds: string[]
): Promise<{ publishedCount: number; errors: string[] }> {
  if (publicationIds.length === 0) {
    return { publishedCount: 0, errors: ["No publications available for this app"] };
  }

  const data = await graphql<{
    publishablePublish: {
      publishable: { availablePublicationsCount: { count: number } } | null;
      userErrors: { field: string[]; message: string }[];
    };
  }>(
    `mutation publishablePublish($id: ID!, $input: [PublicationInput!]!) {
      publishablePublish(id: $id, input: $input) {
        publishable {
          ... on Product {
            availablePublicationsCount { count }
          }
        }
        userErrors { field message }
      }
    }`,
    {
      id: productGid,
      input: publicationIds.map((pid) => ({ publicationId: pid })),
    }
  );

  const errors = data.publishablePublish.userErrors.map((e) => e.message);
  return { publishedCount: publicationIds.length - errors.length, errors };
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
        ...(details.handle ? { handle: details.handle } : {}),
        ...(details.seoTitle || details.seoDescription
          ? {
              seo: {
                ...(details.seoTitle ? { title: details.seoTitle } : {}),
                ...(details.seoDescription ? { description: details.seoDescription } : {}),
              },
            }
          : {}),
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
      const msg = variantErrors.map((e) => e.message).join("; ");
      console.error("[shopify-admin] Variant price update FAILED:", msg);
      throw new Error(`Shopify rejected price ${details.priceGBP}: ${msg}`);
    }

    const updatedVariant = variantData.productVariantsBulkUpdate.productVariants?.[0];
    console.log(
      `[shopify-admin] Variant ${defaultVariantId} priced at ${updatedVariant?.price ?? "?"}`
    );
  } else if (details.priceGBP && !defaultVariantId) {
    console.warn(
      `[shopify-admin] priceGBP=${details.priceGBP} provided but no default variant returned from productCreate. Price NOT set.`
    );
  }

  // 2. Upload images
  let imagesUploaded = 0;
  for (let i = 0; i < libraryItemIds.length; i++) {
    const itemId = libraryItemIds[i];
    onProgress?.(`A fazer upload da imagem ${i + 1} de ${libraryItemIds.length}...`);

    try {
      await uploadImageToProduct(productGid, itemId, details.imageAltText);
      imagesUploaded++;
    } catch (err) {
      console.error(
        `[shopify-admin] Image upload failed for ${itemId}:`,
        err instanceof Error ? err.message : err
      );
      // Continue with other images
    }
  }

  // 3. Publish to sales channels — critical, otherwise the storefront returns 404
  const publishMode = details.publishMode ?? "online-store";
  if (publishMode !== "none") {
    onProgress?.("A publicar nos canais de venda...");
    try {
      const allPubs = await listPublications();
      const chosen = selectPublicationsForMode(allPubs, publishMode);
      if (chosen.length === 0) {
        console.warn(
          `[shopify-admin] publishMode=${publishMode} but no matching publications found. Available: ${allPubs.map((p) => p.name).join(", ") || "(none)"}`
        );
      } else {
        const { publishedCount, errors } = await publishProductToChannels(
          productGid,
          chosen.map((p) => p.id)
        );
        console.log(
          `[shopify-admin] Published ${productGid} to ${publishedCount}/${chosen.length} channel(s): ${chosen.map((c) => c.name).join(", ")}`
        );
        if (errors.length > 0) {
          console.warn(`[shopify-admin] Publish errors: ${errors.join("; ")}`);
        }
      }
    } catch (pubErr) {
      // Non-fatal — product is created, just not visible on the storefront.
      // The user will see the product in admin and can publish manually.
      const msg = pubErr instanceof Error ? pubErr.message : "Publish failed";
      console.error(`[shopify-admin] Channel publish failed for ${productGid}: ${msg}`);
    }
  }

  const domain = await getStoreDomain();
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
  libraryItemId: string,
  altOverride?: string
): Promise<void> {
  const item = await getItem(libraryItemId);
  if (!item) throw new Error(`Library item ${libraryItemId} not found`);

  const imageFile = await readImage(item.result_path);
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
          alt: altOverride ?? item.notes ?? "Product image",
        },
      ],
    }
  );

  const mediaErrors = mediaData.productCreateMedia.mediaUserErrors;
  if (mediaErrors.length > 0) {
    throw new Error(`Media creation error: ${mediaErrors.map((e) => e.message).join("; ")}`);
  }
}
