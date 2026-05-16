import { NextRequest, NextResponse } from "next/server";
import type { ImportOptions } from "@/types/import";
import type { ShopifyProduct } from "@/types/shopify";
import type { ImageRole } from "@/types/preset";
import { translateText, enhanceTitle, enhanceDescription } from "@/lib/translation-service";
import { loadActiveStoreBundle } from "@/lib/store-context";
import { getPreset, composePrompt } from "@/lib/prompt-engine";
import { generateImage } from "@/lib/image-generation";
import { translateImage } from "@/lib/image-translation";
import { applyWatermark } from "@/lib/watermark";

export const runtime = "nodejs";
export const maxDuration = 300;

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
      const storeBundle = await loadActiveStoreBundle();
      const storeCtx = storeBundle?.ctx;

      for (let i = 0; i < total; i++) {
        const handle = opts.selectedHandles[i];
        send({ type: "product-start", productHandle: handle, progress: { current: i + 1, total } });

        try {
          // Fetch product
          send({ type: "step", step: "fetching", productHandle: handle });
          const productRes = await fetch(
            `https://${opts.sourceStore}/products/${handle}.json`,
            { headers: { "User-Agent": "Mozilla/5.0" }, cache: "no-store" }
          );
          if (!productRes.ok) throw new Error(`HTTP ${productRes.status}`);
          const productData = (await productRes.json()) as { product: ShopifyProduct };
          const product = productData.product;

          let title = product.title;
          let description = product.body_html || "";
          const originalDescription = description;

          // Translate
          if (opts.translateEnabled && opts.language !== "en") {
            send({ type: "step", step: "translating", productHandle: handle });
            try {
              title = await translateText(title, opts.language, storeCtx);
              if (description) {
                const plain = description.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
                if (plain.length > 5) {
                  const translated = await translateText(plain, opts.language, storeCtx);
                  if (translated && translated.length > 10) description = `<p>${translated}</p>`;
                }
              }
            } catch { /* keep original */ }
          }

          // Enhance title
          if (opts.enhanceTitleEnabled) {
            send({ type: "step", step: "enhancing-title", productHandle: handle });
            try {
              const enhanced = await enhanceTitle(title, opts.language, product.product_type, storeCtx);
              if (enhanced && enhanced.length > 5) title = enhanced;
            } catch { /* keep current */ }
          }

          // Enhance description
          if (opts.enhanceDescriptionEnabled) {
            send({ type: "step", step: "enhancing-description", productHandle: handle });
            try {
              const enhanced = await enhanceDescription(description, title, opts.language, storeCtx);
              if (enhanced && enhanced.length > 10) description = enhanced;
            } catch { /* keep current */ }
          }

          if (description.replace(/<[^>]+>/g, "").trim().length < 10) {
            description = originalDescription || `<p>${title}</p>`;
          }

          // Process images
          const images: { role: string; originalUrl: string; resultBase64?: string; resultMime?: string; aiGenerated: boolean; error?: string }[] = [];
          const cap = Math.max(1, Math.min(opts.maxImages ?? 20, 50));
          const imagesToProcess = product.images.slice(0, cap);

          for (let j = 0; j < imagesToProcess.length; j++) {
            const img = imagesToProcess[j];
            const role: ImageRole = j === 0 ? "hero" : j === 2 ? "lifestyle" : "detail";
            send({ type: "step", step: "generating-images", productHandle: handle, progress: { current: j + 1, total: imagesToProcess.length } });

            try {
              const imgRes = await fetch(img.src, { headers: { "User-Agent": "Mozilla/5.0" } });
              if (!imgRes.ok) {
                images.push({ role, originalUrl: img.src, aiGenerated: false, error: `Download failed: ${imgRes.status}` });
                continue;
              }
              const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
              const imgBase64 = imgBuffer.toString("base64");
              const imgMime = imgRes.headers.get("content-type") || "image/png";

              let workingBase64 = imgBase64;
              let workingMime = imgMime;

              if (opts.translateImagesEnabled && opts.language) {
                send({ type: "step", step: "translating-images", productHandle: handle, progress: { current: j + 1, total: imagesToProcess.length } });
                try {
                  const translated = await translateImage({
                    imageBase64: workingBase64,
                    mimeType: workingMime,
                    targetLang: opts.language,
                    modelSlug: opts.translateImagesModel,
                    replaceBrandWith: storeBundle?.brandShortName,
                  });
                  workingBase64 = translated.imageBase64;
                  workingMime = translated.mimeType;
                } catch (trErr) {
                  const trMsg = trErr instanceof Error ? trErr.message : "Image translation failed";
                  console.error(`[preview] Image translation ${j} failed for ${handle}: ${trMsg}`);
                  send({ type: "step", step: "translate-image-failed", productHandle: handle, error: trMsg });
                }
              }

              if (opts.aiImagesEnabled && opts.aiImagePresetId) {
                const preset = await getPreset(opts.aiImagePresetId);
                if (preset) {
                  const prompt = composePrompt({ preset, role, collection: opts.aiImageCollection, customPrompt: opts.aiImageCustomPrompt });
                  try {
                    const result = await generateImage({
                      modelSlug: opts.imageModel,
                      prompt,
                      sourceImageBase64: workingBase64,
                      sourceMimeType: workingMime,
                    });
                    workingBase64 = result.imageBase64;
                    workingMime = result.mimeType;
                  } catch (aiErr) {
                    const msg = aiErr instanceof Error ? aiErr.message : "AI failed";
                    images.push({ role, originalUrl: img.src, resultBase64: workingBase64, resultMime: workingMime, aiGenerated: false, error: msg });
                    continue;
                  }
                }
              }

              // Apply watermark as the final step (preview)
              if (opts.watermarkEnabled && storeBundle && (storeBundle.logoUrl || storeBundle.brandShortName)) {
                send({ type: "step", step: "watermarking", productHandle: handle, progress: { current: j + 1, total: imagesToProcess.length } });
                try {
                  const wm = await applyWatermark({
                    imageBase64: workingBase64,
                    mimeType: workingMime,
                    options: {
                      logoUrl: storeBundle.logoUrl,
                      brandShortName: storeBundle.brandShortName,
                      position: opts.watermarkPosition,
                      opacity: opts.watermarkOpacity,
                      size: opts.watermarkSize,
                    },
                  });
                  if (wm.applied) {
                    workingBase64 = wm.imageBase64;
                    workingMime = wm.mimeType;
                  }
                } catch { /* keep working image */ }
              }

              images.push({ role, originalUrl: img.src, resultBase64: workingBase64, resultMime: workingMime, aiGenerated: workingBase64 !== imgBase64 });
            } catch (err) {
              images.push({ role, originalUrl: img.src, aiGenerated: false, error: err instanceof Error ? err.message : "Failed" });
            }
          }

          // Compute price
          let price = "29.95";
          const originalPrice = product.variants[0]?.price;
          if (opts.pricingMode === "original" && originalPrice) price = originalPrice;
          else if (opts.pricingMode === "markup" && originalPrice && opts.markupPercent !== undefined) {
            const base = parseFloat(originalPrice);
            if (!isNaN(base)) price = (base * (1 + opts.markupPercent / 100)).toFixed(2);
          } else if (opts.pricingMode === "fixed" && opts.fixedPrice) price = opts.fixedPrice;

          send({
            type: "product-preview",
            productHandle: handle,
            product: {
              handle,
              title,
              description,
              originalTitle: product.title,
              originalDescription: product.body_html || "",
              vendor: product.vendor,
              productType: product.product_type,
              price,
              images,
            },
          });
        } catch (err) {
          send({ type: "product-error", productHandle: handle, error: err instanceof Error ? err.message : "Failed" });
        }
      }

      send({ type: "complete" });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
