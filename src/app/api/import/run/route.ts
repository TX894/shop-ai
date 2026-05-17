import { NextRequest, NextResponse } from "next/server";
import type { ImportOptions } from "@/types/import";
import type { ShopifyProduct } from "@/types/shopify";
import type { ImageRole } from "@/types/preset";
import { translateText, enhanceTitle, enhanceDescription, generateSeoBundle, type StoreContext } from "@/lib/translation-service";
import { loadActiveStoreBundle, type ActiveStoreBundle } from "@/lib/store-context";
import { getPreset, composePrompt } from "@/lib/prompt-engine";
import { generateImage } from "@/lib/image-generation";
import { translateImage } from "@/lib/image-translation";
import { applyWatermark } from "@/lib/watermark";
import { graphql, type PushResult } from "@/lib/shopify-admin";
import { getStoreDomain } from "@/lib/shopify-auth";
import { insertItem } from "@/lib/db";
import { saveImage, generateId } from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 300;

/** kie.ai is rate-limited to 20 req/10s. 3 in-flight image translations
 *  + their polling stays comfortably under the limit, while still cutting
 *  total wall time to ~2× the slowest image instead of N× sequential. */
const IMAGE_PIPELINE_CONCURRENCY = 3;

/**
 * Run an async mapper over `items` with a bounded number of concurrent
 * workers. Preserves input order in the returned array.
 */
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
  let opts: ImportOptions;
  try {
    opts = (await req.json()) as ImportOptions;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!opts.selectedHandles?.length || !opts.sourceStore) {
    return NextResponse.json({ error: "selectedHandles and sourceStore required" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(data: Record<string, unknown>) {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch { /* disconnected */ }
      }

      const total = opts.selectedHandles.length;
      let successCount = 0;
      let failCount = 0;
      const failures: { handle: string; error: string }[] = [];

      // Load store brand bundle once for the whole batch
      const storeBundle: ActiveStoreBundle | undefined = await loadActiveStoreBundle();
      const storeCtx: StoreContext | undefined = storeBundle?.ctx;

      for (let i = 0; i < total; i++) {
        const handle = opts.selectedHandles[i];
        send({
          type: "product-start",
          productHandle: handle,
          progress: { current: i + 1, total },
        });

        try {
          // 1. Fetch product data from source store
          send({ type: "step", step: "fetching", productHandle: handle });
          const productRes = await fetch(
            `https://${opts.sourceStore}/products/${handle}.json`,
            { headers: { "User-Agent": "Mozilla/5.0" }, cache: "no-store" }
          );
          if (!productRes.ok) throw new Error(`Failed to fetch product: HTTP ${productRes.status}`);
          const productData = (await productRes.json()) as { product: ShopifyProduct };
          const product = productData.product;

          let title = product.title;
          let description = product.body_html || "";

          const originalTitle = title;
          const originalDescription = description;

          // 2. Translate if enabled
          if (opts.translateEnabled && opts.language !== "en") {
            send({ type: "step", step: "translating", productHandle: handle, productTitle: title });
            try {
              title = await translateText(title, opts.language, storeCtx);
              if (description) {
                // Strip complex HTML to plain text for better translation
                const plainDesc = description.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
                if (plainDesc.length > 5) {
                  const translated = await translateText(plainDesc, opts.language, storeCtx);
                  if (translated && translated.length > 10) {
                    description = `<p>${translated}</p>`;
                  }
                }
              }
            } catch (err) {
              console.error(`[import] Translation failed for ${handle}:`, err instanceof Error ? err.message : err);
              title = originalTitle;
            }
          }

          // 3. Enhance title if enabled
          if (opts.enhanceTitleEnabled) {
            send({ type: "step", step: "enhancing-title", productHandle: handle, productTitle: title });
            try {
              const enhanced = await enhanceTitle(title, opts.language, product.product_type, storeCtx);
              if (enhanced && enhanced.length > 5) title = enhanced;
            } catch (err) {
              console.error(`[import] Enhance title failed for ${handle}:`, err instanceof Error ? err.message : err);
            }
          }

          // 4. Enhance description if enabled
          if (opts.enhanceDescriptionEnabled) {
            send({ type: "step", step: "enhancing-description", productHandle: handle, productTitle: title });
            try {
              const enhanced = await enhanceDescription(description, title, opts.language, storeCtx);
              if (enhanced && enhanced.length > 10) {
                description = enhanced;
              }
            } catch (err) {
              console.error(`[import] Enhance description failed for ${handle}:`, err instanceof Error ? err.message : err);
            }
          }

          // 4b. Generate SEO bundle (meta title/desc, handle, tags, alt) if requested
          let seoBundle: Awaited<ReturnType<typeof generateSeoBundle>> = null;
          if (opts.seoEnabled) {
            send({ type: "step", step: "seo-bundle", productHandle: handle, productTitle: title });
            try {
              seoBundle = await generateSeoBundle(title, description, opts.language, storeCtx);
            } catch (err) {
              console.error(`[import] SEO bundle failed for ${handle}:`, err instanceof Error ? err.message : err);
            }
          }

          // Fallback: if description ended up too short, use original
          if (description.replace(/<[^>]+>/g, "").trim().length < 10) {
            description = originalDescription || `<p>${title}</p>`;
          }

          // 5. Compute price
          let price = "29.95";
          const originalPrice = product.variants[0]?.price;
          if (opts.pricingMode === "original" && originalPrice) {
            price = originalPrice;
          } else if (opts.pricingMode === "markup" && originalPrice && opts.markupPercent !== undefined) {
            const base = parseFloat(originalPrice);
            if (!isNaN(base)) {
              price = (base * (1 + opts.markupPercent / 100)).toFixed(2);
            }
          } else if (opts.pricingMode === "fixed" && opts.fixedPrice) {
            price = opts.fixedPrice;
          }

          // 6. Process images IN PARALLEL.
          // Image translation with Nano Banana 2 averages 40-90 s per image;
          // running 5 images sequentially blows the 300 s Vercel budget.
          // Promise.all here brings 5 images down to ~max(per-image-time)
          // because kie.ai polls run concurrently.
          const cap = Math.max(1, Math.min(opts.maxImages ?? 20, 50));
          const imagesToProcess = product.images.slice(0, cap);
          let completedImageCount = 0;

          send({
            type: "step",
            step: "generating-images",
            productHandle: handle,
            productTitle: title,
            progress: { current: 0, total: imagesToProcess.length },
          });

          // Counters for the per-product translation summary
          let translatedCount = 0;
          let untranslatedCount = 0;

          const settled = await mapWithConcurrency(imagesToProcess, IMAGE_PIPELINE_CONCURRENCY, async (img, j): Promise<string | null> => {
            // j=0 → hero, j=1 → detail, j=2 → lifestyle, j>=3 → detail (multiple angles)
            const role: ImageRole = j === 0 ? "hero" : j === 2 ? "lifestyle" : "detail";

            try {
              // Download original image
              const imgRes = await fetch(img.src, { headers: { "User-Agent": "Mozilla/5.0" } });
              if (!imgRes.ok) {
                console.error(`[import] Image download failed for ${handle} img ${j}: HTTP ${imgRes.status}`);
                completedImageCount++;
                return null;
              }
              const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
              const imgBase64 = imgBuffer.toString("base64");
              const imgMime = imgRes.headers.get("content-type") || "image/png";

              let resultBase64 = imgBase64;
              let resultMime = imgMime;
              let promptUsed: string | undefined;
              let aiImageFailed = false;

              // 6a. Translate text inside the image
              if (opts.translateImagesEnabled && opts.language) {
                try {
                  const translated = await translateImage({
                    imageBase64: resultBase64,
                    mimeType: resultMime,
                    targetLang: opts.language,
                    modelSlug: opts.translateImagesModel,
                    replaceBrandWith: storeBundle?.brandShortName,
                  });
                  resultBase64 = translated.imageBase64;
                  resultMime = translated.mimeType;
                  if (translated.changed) {
                    translatedCount++;
                  } else {
                    untranslatedCount++;
                    console.warn(`[import] Image translation ${j} returned unchanged image for ${handle} (model returned source as-is)`);
                    send({ type: "step", step: "translate-image-unchanged", productHandle: handle, error: `Image ${j + 1} came back unchanged from the model` });
                  }
                } catch (trErr) {
                  untranslatedCount++;
                  const trMsg = trErr instanceof Error ? trErr.message : "Image translation failed";
                  console.error(`[import] Image translation ${j} failed for ${handle}: ${trMsg}`);
                  send({ type: "step", step: "translate-image-failed", productHandle: handle, error: trMsg });
                }
              }

              // 6b. AI restyle
              if (opts.aiImagesEnabled && opts.aiImagePresetId) {
                const preset = await getPreset(opts.aiImagePresetId);
                if (preset) {
                  const prompt = composePrompt({
                    preset, role,
                    collection: opts.aiImageCollection,
                    customPrompt: opts.aiImageCustomPrompt,
                  });
                  promptUsed = prompt;
                  try {
                    const genResult = await generateImage({
                      modelSlug: opts.imageModel,
                      prompt,
                      sourceImageBase64: resultBase64,
                      sourceMimeType: resultMime,
                    });
                    resultBase64 = genResult.imageBase64;
                    resultMime = genResult.mimeType;
                  } catch (aiErr) {
                    aiImageFailed = true;
                    const aiMsg = aiErr instanceof Error ? aiErr.message : "AI image failed";
                    console.error(`[import] AI image ${j} failed for ${handle}: ${aiMsg}`);
                    send({ type: "step", step: "ai-image-failed", productHandle: handle, error: aiMsg });
                  }
                }
              }

              // 6c. Brand watermark (LAST)
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
                  console.error(`[import] Watermark ${j} failed for ${handle}:`, wmErr instanceof Error ? wmErr.message : wmErr);
                }
              }

              // Save to library
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
                source_store: opts.sourceStore,
                source_product_url: `https://${opts.sourceStore}/products/${handle}`,
              });

              completedImageCount++;
              send({
                type: "step",
                step: "image-done",
                productHandle: handle,
                productTitle: title,
                progress: { current: completedImageCount, total: imagesToProcess.length },
              });

              return itemId;
            } catch (imgErr) {
              console.error(`[import] Image ${j} failed entirely for ${handle}:`, imgErr instanceof Error ? imgErr.message : imgErr);
              completedImageCount++;
              return null;
            }
          });

          const libraryItemIds = settled.filter((id): id is string => !!id);

          // Per-product translation summary — surfaced so the user immediately
          // sees how many images actually came back translated vs original.
          if (opts.translateImagesEnabled && imagesToProcess.length > 0) {
            send({
              type: "step",
              step: "translation-summary",
              productHandle: handle,
              progress: { current: translatedCount, total: imagesToProcess.length },
              error: untranslatedCount > 0 ? `${untranslatedCount} image(s) came back without translation` : undefined,
            });
          }

          // 7. Create Shopify product
          send({ type: "step", step: "creating-shopify", productHandle: handle, productTitle: title });

          // Merge SEO bundle tags with user-provided tags (dedupe)
          const mergedTags = Array.from(
            new Set([
              ...opts.tags,
              ...(seoBundle?.tags ?? []),
            ])
          );

          const pushResult = await createShopifyProduct(
            libraryItemIds,
            {
              title,
              descriptionHtml: description,
              priceGBP: price,
              vendor: product.vendor || "",
              productType: product.product_type || "",
              tags: mergedTags,
              status: opts.productStatus,
              seoTitle: seoBundle?.metaTitle,
              seoDescription: seoBundle?.metaDescription,
              handle: seoBundle?.handle,
              imageAltText: seoBundle?.altText,
              publishMode: opts.publishMode ?? "online-store",
            },
            opts.collectionIds
          );

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
            productHandle: handle,
            productTitle: title,
            result: {
              shopifyProductId: pushResult.productId,
              adminUrl: pushResult.adminUrl,
            },
          });
          successCount++;
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : "Unknown error";
          send({
            type: "product-error",
            productHandle: handle,
            error: errorMsg,
          });
          failures.push({ handle, error: errorMsg });
          failCount++;
        }
      }

      send({
        type: "complete",
        summary: { total, success: successCount, failed: failCount },
      });
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

// Reuses logic from shopify-admin.ts but with direct image buffers
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
  // Import push function
  const { pushProduct } = await import("@/lib/shopify-admin");
  const result = await pushProduct(libraryItemIds, {
    title: details.title,
    descriptionHtml: details.descriptionHtml,
    priceGBP: details.priceGBP,
    vendor: details.vendor,
    productType: details.productType,
    tags: details.tags,
    status: details.status,
    seoTitle: details.seoTitle,
    seoDescription: details.seoDescription,
    handle: details.handle,
    imageAltText: details.imageAltText,
    publishMode: details.publishMode,
  });

  // Add to collections
  if (collectionIds.length > 0) {
    for (const collectionId of collectionIds) {
      try {
        await graphql(
          `mutation collectionAddProducts($id: ID!, $productIds: [ID!]!) {
            collectionAddProducts(id: $id, productIds: $productIds) {
              collection { id }
              userErrors { field message }
            }
          }`,
          { id: collectionId, productIds: [result.productId] }
        );
      } catch {
        // Non-fatal — product is created, just not in collection
      }
    }
  }

  return result;
}
