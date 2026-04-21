import { NextRequest, NextResponse } from "next/server";
import type { ImportOptions } from "@/types/import";
import type { ShopifyProduct } from "@/types/shopify";
import type { ImageRole } from "@/types/preset";
import { translateText, enhanceTitle, enhanceDescription } from "@/lib/translation-service";
import { getPreset, composePrompt } from "@/lib/prompt-engine";
import { generateImage } from "@/lib/image-generation";

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
              title = await translateText(title, opts.language);
              if (description) {
                const plain = description.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
                if (plain.length > 5) {
                  const translated = await translateText(plain, opts.language);
                  if (translated && translated.length > 10) description = `<p>${translated}</p>`;
                }
              }
            } catch { /* keep original */ }
          }

          // Enhance title
          if (opts.enhanceTitleEnabled) {
            send({ type: "step", step: "enhancing-title", productHandle: handle });
            try {
              const enhanced = await enhanceTitle(title, opts.language, product.product_type);
              if (enhanced && enhanced.length > 5) title = enhanced;
            } catch { /* keep current */ }
          }

          // Enhance description
          if (opts.enhanceDescriptionEnabled) {
            send({ type: "step", step: "enhancing-description", productHandle: handle });
            try {
              const plain = description.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
              const enhanced = await enhanceDescription(plain, title, opts.language);
              if (enhanced && enhanced.length > 10) description = enhanced;
            } catch { /* keep current */ }
          }

          if (description.replace(/<[^>]+>/g, "").trim().length < 10) {
            description = originalDescription || `<p>${title}</p>`;
          }

          // Process images
          const images: { role: string; originalUrl: string; resultBase64?: string; resultMime?: string; aiGenerated: boolean; error?: string }[] = [];
          const imagesToProcess = product.images.slice(0, 3);

          for (let j = 0; j < imagesToProcess.length; j++) {
            const img = imagesToProcess[j];
            const role = DEFAULT_ROLES[j] ?? "hero";
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

              if (opts.aiImagesEnabled && opts.aiImagePresetId) {
                const preset = await getPreset(opts.aiImagePresetId);
                if (preset) {
                  const prompt = composePrompt({ preset, role, collection: opts.aiImageCollection, customPrompt: opts.aiImageCustomPrompt });
                  try {
                    const result = await generateImage({
                      modelSlug: opts.imageModel,
                      prompt,
                      sourceImageBase64: imgBase64,
                      sourceMimeType: imgMime,
                    });
                    images.push({ role, originalUrl: img.src, resultBase64: result.imageBase64, resultMime: result.mimeType, aiGenerated: true });
                    continue;
                  } catch (aiErr) {
                    const msg = aiErr instanceof Error ? aiErr.message : "AI failed";
                    images.push({ role, originalUrl: img.src, resultBase64: imgBase64, resultMime: imgMime, aiGenerated: false, error: msg });
                    continue;
                  }
                }
              }
              // No AI — use original
              images.push({ role, originalUrl: img.src, resultBase64: imgBase64, resultMime: imgMime, aiGenerated: false });
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
