import { NextRequest, NextResponse } from "next/server";
import type { ImportOptions } from "@/types/import";
import type { ShopifyProduct } from "@/types/shopify";
import type { ImageRole } from "@/types/preset";
import { translateText, enhanceTitle, enhanceDescription } from "@/lib/translation-service";
import { getPreset, composePrompt } from "@/lib/prompt-engine";
import { editImage } from "@/lib/gemini";
import { graphql, type PushResult } from "@/lib/shopify-admin";
import { getStoreDomain } from "@/lib/shopify-auth";
import { insertItem } from "@/lib/db";
import { saveImage, generateId } from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 300;

const DEFAULT_ROLES: ImageRole[] = ["hero", "detail", "lifestyle"];

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
              title = await translateText(title, opts.language);
              if (description) {
                // Strip complex HTML to plain text for better translation
                const plainDesc = description.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
                if (plainDesc.length > 5) {
                  const translated = await translateText(plainDesc, opts.language);
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
              const enhanced = await enhanceTitle(title, opts.language, product.product_type);
              if (enhanced && enhanced.length > 5) title = enhanced;
            } catch (err) {
              console.error(`[import] Enhance title failed for ${handle}:`, err instanceof Error ? err.message : err);
            }
          }

          // 4. Enhance description if enabled
          if (opts.enhanceDescriptionEnabled) {
            send({ type: "step", step: "enhancing-description", productHandle: handle, productTitle: title });
            try {
              const plainDesc = description.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
              const enhanced = await enhanceDescription(plainDesc, title, opts.language);
              if (enhanced && enhanced.length > 10) {
                description = enhanced;
              }
            } catch (err) {
              console.error(`[import] Enhance description failed for ${handle}:`, err instanceof Error ? err.message : err);
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

          // 6. Process images (AI or original)
          const libraryItemIds: string[] = [];
          const imagesToProcess = product.images.slice(0, 3);

          for (let j = 0; j < imagesToProcess.length; j++) {
            const img = imagesToProcess[j];
            const role = DEFAULT_ROLES[j] ?? "hero";

            send({
              type: "step",
              step: opts.aiImagesEnabled ? "generating-images" : "downloading-images",
              productHandle: handle,
              productTitle: title,
              progress: { current: j + 1, total: imagesToProcess.length },
            });

            try {
              // Download original image
              const imgRes = await fetch(img.src, {
                headers: { "User-Agent": "Mozilla/5.0" },
              });
              if (!imgRes.ok) {
                console.error(`[import] Image download failed for ${handle} img ${j}: HTTP ${imgRes.status}`);
                continue;
              }
              const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
              const imgBase64 = imgBuffer.toString("base64");
              const imgMime = imgRes.headers.get("content-type") || "image/png";

              let resultBase64 = imgBase64;
              let resultMime = imgMime;
              let promptUsed: string | undefined;
              let aiImageFailed = false;

              if (opts.aiImagesEnabled && opts.aiImagePresetId) {
                const preset = await getPreset(opts.aiImagePresetId);
                if (preset) {
                  const prompt = composePrompt({
                    preset,
                    role,
                    collection: opts.aiImageCollection,
                    customPrompt: opts.aiImageCustomPrompt,
                  });
                  promptUsed = prompt;

                  try {
                    const edited = await editImage({
                      imageBase64: imgBase64,
                      mimeType: imgMime,
                      prompt,
                    });
                    resultBase64 = edited.imageBase64;
                    resultMime = edited.mimeType;
                  } catch (aiErr) {
                    aiImageFailed = true;
                    const aiMsg = aiErr instanceof Error ? aiErr.message : "AI image failed";
                    console.error(`[import] AI image ${j} failed for ${handle}: ${aiMsg}`);
                    send({
                      type: "step",
                      step: "ai-image-failed",
                      productHandle: handle,
                      error: aiMsg,
                    });
                    // Fall back to original image
                  }
                }
              }

              // Save to library (AI result or original fallback)
              const itemId = generateId();
              const originalPath = saveImage(imgBase64, imgMime, `${itemId}-original`);
              const resultPath = saveImage(resultBase64, resultMime, `${itemId}-result`);

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

              libraryItemIds.push(itemId);
            } catch (imgErr) {
              console.error(`[import] Image ${j} failed entirely for ${handle}:`, imgErr instanceof Error ? imgErr.message : imgErr);
            }
          }

          // 7. Create Shopify product
          send({ type: "step", step: "creating-shopify", productHandle: handle, productTitle: title });

          const pushResult = await createShopifyProduct(
            libraryItemIds,
            {
              title,
              descriptionHtml: description,
              priceGBP: price,
              vendor: product.vendor || "",
              productType: product.product_type || "",
              tags: opts.tags,
              status: opts.productStatus,
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
