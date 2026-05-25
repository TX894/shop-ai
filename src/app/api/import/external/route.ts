/**
 * Import a pre-scraped product (from the Temu bookmarklet / Chrome extension)
 * into the active Shopify store.
 *
 * Same downstream pipeline as /api/import/run — text translate / enhance /
 * SEO bundle / per-image translation + watermark / Shopify create + publish —
 * but the product data is provided in the request body instead of being
 * fetched from a Shopify /products.json endpoint.
 *
 * This is the architectural answer to "Cloudflare blocks the scraper": we
 * never scrape server-side. The user's browser scrapes the source page
 * (Temu, AliExpress, Amazon...) and posts the payload here.
 */

import { NextRequest, NextResponse } from "next/server";
import type {
  ExternalImportRequest,
  ExternalImportOptions,
} from "@/types/external-import";
import type { ImageRole } from "@/types/preset";
import {
  translateText,
  enhanceTitle,
  enhanceDescription,
  generateSeoBundle,
  type StoreContext,
} from "@/lib/translation-service";
import { loadActiveStoreBundle, type ActiveStoreBundle } from "@/lib/store-context";
import { getPreset, composePrompt } from "@/lib/prompt-engine";
import { generateImage } from "@/lib/image-generation";
import { translateImage } from "@/lib/image-translation";
import { applyWatermark } from "@/lib/watermark";
import { graphql, type PushResult } from "@/lib/shopify-admin";
import { insertItem } from "@/lib/db";
import { saveImage, generateId } from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 300;

const IMAGE_PIPELINE_CONCURRENCY = 3;

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

export async function POST(req: NextRequest) {
  let body: ExternalImportRequest;
  try {
    body = (await req.json()) as ExternalImportRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.product?.title || !Array.isArray(body.product?.imageUrls)) {
    return NextResponse.json({ error: "product.title and product.imageUrls are required" }, { status: 400 });
  }
  const opts: ExternalImportOptions = body.options ?? { language: "fr" };

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(data: Record<string, unknown>) {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch { /* disconnected */ }
      }

      try {
        const storeBundle: ActiveStoreBundle | undefined = await loadActiveStoreBundle();
        const storeCtx: StoreContext | undefined = storeBundle?.ctx;

        // For brand replacement: use sourceBrand if it looks like an actual brand
        // (Temu, AliExpress, Amazon, etc.). If empty, leave it null.
        const competitorBrand = body.product.sourceBrand?.trim() || null;

        let title = body.product.title;
        let description = body.product.descriptionHtml || "";
        const originalDescription = description;

        // 1. Translate
        if (opts.translateEnabled && opts.language && opts.language !== "en") {
          send({ type: "step", step: "translating" });
          try {
            title = await translateText(title, opts.language, storeCtx);
            if (description) {
              const plain = description.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
              if (plain.length > 5) {
                const translated = await translateText(plain, opts.language, storeCtx);
                if (translated && translated.length > 10) description = `<p>${translated}</p>`;
              }
            }
          } catch (err) {
            console.error("[external-import] translate failed:", err);
          }
        }

        // 2. Enhance title
        if (opts.enhanceTitleEnabled) {
          send({ type: "step", step: "enhancing-title" });
          try {
            const enhanced = await enhanceTitle(title, opts.language, body.product.productType, storeCtx);
            if (enhanced && enhanced.length > 5) title = enhanced;
          } catch (err) {
            console.error("[external-import] enhance title failed:", err);
          }
        }

        // 3. Enhance description
        if (opts.enhanceDescriptionEnabled) {
          send({ type: "step", step: "enhancing-description" });
          try {
            const enhanced = await enhanceDescription(description, title, opts.language, storeCtx);
            if (enhanced && enhanced.length > 10) description = enhanced;
          } catch (err) {
            console.error("[external-import] enhance desc failed:", err);
          }
        }
        if (description.replace(/<[^>]+>/g, "").trim().length < 10) {
          description = originalDescription || `<p>${title}</p>`;
        }

        // 4. SEO bundle
        let seoBundle: Awaited<ReturnType<typeof generateSeoBundle>> = null;
        if (opts.seoEnabled) {
          send({ type: "step", step: "seo-bundle" });
          try {
            seoBundle = await generateSeoBundle(title, description, opts.language, storeCtx);
          } catch (err) {
            console.error("[external-import] seo bundle failed:", err);
          }
        }

        // 5. Price
        let price = "29.95";
        const original = body.product.priceOriginal;
        if (opts.pricingMode === "original" && original) {
          price = original;
        } else if (opts.pricingMode === "markup" && original && opts.markupPercent !== undefined) {
          const base = parseFloat(original);
          if (!isNaN(base)) price = (base * (1 + opts.markupPercent / 100)).toFixed(2);
        } else if (opts.pricingMode === "fixed" && opts.fixedPrice) {
          price = opts.fixedPrice;
        } else if (original) {
          price = original;
        }

        // 6. Images — process in parallel
        const cap = Math.max(1, Math.min(opts.maxImages ?? 10, 50));
        const imagesToProcess = body.product.imageUrls.slice(0, cap);
        let completed = 0;
        let translatedCount = 0;

        send({
          type: "step",
          step: "generating-images",
          progress: { current: 0, total: imagesToProcess.length },
        });

        const settled = await mapWithConcurrency(imagesToProcess, IMAGE_PIPELINE_CONCURRENCY, async (imgUrl, j): Promise<string | null> => {
          const role: ImageRole = j === 0 ? "hero" : j === 2 ? "lifestyle" : "detail";
          try {
            const imgRes = await fetch(imgUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
            if (!imgRes.ok) {
              completed++;
              return null;
            }
            const buf = Buffer.from(await imgRes.arrayBuffer());
            const imgBase64 = buf.toString("base64");
            const imgMime = imgRes.headers.get("content-type") || "image/png";

            let resultBase64 = imgBase64;
            let resultMime = imgMime;
            let promptUsed: string | undefined;
            let aiImageFailed = false;

            // 6a. Image text translation
            if (opts.translateImagesEnabled && opts.language) {
              try {
                const translated = await translateImage({
                  imageBase64: resultBase64,
                  mimeType: resultMime,
                  targetLang: opts.language,
                  modelSlug: opts.translateImagesModel,
                  replaceBrandWith: storeBundle?.brandShortName,
                  replaceBrandFrom: competitorBrand,
                });
                resultBase64 = translated.imageBase64;
                resultMime = translated.mimeType;
                if (translated.changed) translatedCount++;
              } catch (trErr) {
                console.error(`[external-import] image translate ${j} failed:`, trErr);
              }
            }

            // 6b. AI restyle
            if (opts.aiImagesEnabled && opts.aiImagePresetId) {
              const preset = await getPreset(opts.aiImagePresetId);
              if (preset) {
                const prompt = composePrompt({ preset, role, collection: opts.aiImageCollection, customPrompt: opts.aiImageCustomPrompt });
                promptUsed = prompt;
                try {
                  const gen = await generateImage({
                    modelSlug: opts.imageModel,
                    prompt,
                    sourceImageBase64: resultBase64,
                    sourceMimeType: resultMime,
                  });
                  resultBase64 = gen.imageBase64;
                  resultMime = gen.mimeType;
                } catch (aiErr) {
                  aiImageFailed = true;
                  console.error(`[external-import] AI image ${j} failed:`, aiErr);
                }
              }
            }

            // 6c. Watermark (last)
            if (opts.watermarkEnabled && storeBundle && (storeBundle.logoUrl || storeBundle.brandShortName)) {
              try {
                const wm = await applyWatermark({
                  imageBase64: resultBase64,
                  mimeType: resultMime,
                  options: {
                    logoUrl: storeBundle.logoUrl,
                    brandShortName: storeBundle.brandShortName,
                    position: opts.watermarkPosition,
                    opacity: opts.watermarkOpacity,
                    size: opts.watermarkSize,
                  },
                });
                if (wm.applied) {
                  resultBase64 = wm.imageBase64;
                  resultMime = wm.mimeType;
                }
              } catch (wmErr) {
                console.error(`[external-import] watermark ${j} failed:`, wmErr);
              }
            }

            const itemId = generateId();
            const originalPath = await saveImage(imgBase64, imgMime, `${itemId}-original`);
            const resultPath = await saveImage(resultBase64, resultMime, `${itemId}-result`);

            await insertItem({
              id: itemId,
              preset_id: opts.aiImagePresetId ?? "none",
              collection: opts.aiImageCollection ?? "general",
              role,
              prompt: aiImageFailed ? undefined : promptUsed,
              original_path: originalPath,
              result_path: resultPath,
              original_mime: imgMime,
              result_mime: resultMime,
              notes: title,
              source_store: body.product.sourceBrand || "external",
              source_product_url: body.product.sourceUrl,
            });

            completed++;
            send({
              type: "step",
              step: "image-done",
              progress: { current: completed, total: imagesToProcess.length },
            });
            return itemId;
          } catch (err) {
            console.error(`[external-import] image ${j} failed entirely:`, err);
            completed++;
            return null;
          }
        });

        const libraryItemIds = settled.filter((id): id is string => !!id);

        if (opts.translateImagesEnabled && imagesToProcess.length > 0) {
          send({
            type: "step",
            step: "translation-summary",
            progress: { current: translatedCount, total: imagesToProcess.length },
          });
        }

        // 7. Push to Shopify
        send({ type: "step", step: "creating-shopify" });
        const mergedTags = Array.from(new Set([...(opts.tags ?? []), ...(seoBundle?.tags ?? [])]));
        const pushResult = await createShopifyProduct(libraryItemIds, {
          title,
          descriptionHtml: description,
          priceGBP: price,
          vendor: body.product.vendor ?? "",
          productType: body.product.productType ?? "",
          tags: mergedTags,
          status: opts.productStatus ?? "DRAFT",
          seoTitle: seoBundle?.metaTitle,
          seoDescription: seoBundle?.metaDescription,
          handle: seoBundle?.handle ?? body.product.handle,
          imageAltText: seoBundle?.altText,
          publishMode: opts.publishMode ?? "online-store",
        }, opts.collectionIds ?? []);

        // 8. Update library items with Shopify info
        const { updateItemShopify } = await import("@/lib/db");
        const now = new Date().toISOString();
        for (const libId of libraryItemIds) {
          await updateItemShopify(libId, {
            shopify_product_id: pushResult.productId,
            shopify_admin_url: pushResult.adminUrl,
            imported_at: now,
          });
        }

        send({
          type: "product-done",
          productTitle: title,
          result: {
            shopifyProductId: pushResult.productId,
            adminUrl: pushResult.adminUrl,
          },
        });
      } catch (err) {
        send({ type: "product-error", error: err instanceof Error ? err.message : "Unknown error" });
      }

      send({ type: "complete" });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

async function createShopifyProduct(
  libraryItemIds: string[],
  details: {
    title: string;
    descriptionHtml: string;
    priceGBP: string;
    vendor: string;
    productType: string;
    tags: string[];
    status: "DRAFT" | "ACTIVE";
    seoTitle?: string;
    seoDescription?: string;
    handle?: string;
    imageAltText?: string;
    publishMode?: "online-store" | "all" | "none";
  },
  collectionIds: string[]
): Promise<PushResult> {
  const { pushProduct } = await import("@/lib/shopify-admin");
  const result = await pushProduct(libraryItemIds, details);
  if (collectionIds.length > 0) {
    for (const collectionId of collectionIds) {
      try {
        await graphql(
          `mutation collectionAddProducts($id: ID!, $productIds: [ID!]!) {
            collectionAddProducts(id: $id, productIds: $productIds) {
              userErrors { field message }
            }
          }`,
          { id: collectionId, productIds: [result.productId] }
        );
      } catch { /* non-fatal */ }
    }
  }
  return result;
}
