import { NextRequest, NextResponse } from "next/server";
import { claimNextProduct, markProductDone, markProductFailed } from "@/lib/jobs";
import type { ImportOptions } from "@/types/import";
import type { ShopifyProduct } from "@/types/shopify";
import type { ImageRole } from "@/types/preset";
import { translateText, enhanceTitle, enhanceDescription } from "@/lib/translation-service";
import { getPreset, composePrompt } from "@/lib/prompt-engine";
import { editImage } from "@/lib/gemini";
import { getJob } from "@/lib/jobs";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_PRODUCTS_PER_CALL = 2;
const DELAY_BETWEEN_MS = 500;
const DEFAULT_ROLES: ImageRole[] = ["hero", "detail", "lifestyle"];

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: jobId } = await params;

  const job = await getJob(jobId);
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  if (job.status === "done" || job.status === "failed") {
    return NextResponse.json({ status: job.status, message: "Job already finished" });
  }

  const opts: ImportOptions = JSON.parse(job.options);
  let processed = 0;

  while (processed < MAX_PRODUCTS_PER_CALL) {
    const claimed = await claimNextProduct(jobId);
    if (!claimed) break; // No more pending products

    const { productIndex } = claimed;
    const product = claimed.job.product_queue[productIndex];

    try {
      const result = await processOneProduct(product.handle, product.sourceStore, opts);
      await markProductDone(jobId, productIndex, result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      await markProductFailed(jobId, productIndex, msg);
    }

    processed++;

    // Delay between products to avoid rate limits
    if (processed < MAX_PRODUCTS_PER_CALL) {
      await sleep(DELAY_BETWEEN_MS);
    }
  }

  // Fetch final state
  const updated = await getJob(jobId);
  return NextResponse.json({
    status: updated?.status ?? "unknown",
    completed: updated?.completed_products ?? 0,
    failed: updated?.failed_products ?? 0,
    total: updated?.total_products ?? 0,
    processed_this_call: processed,
  });
}

async function processOneProduct(
  handle: string,
  sourceStore: string,
  opts: ImportOptions
) {
  // 1. Fetch product data
  const productRes = await fetch(
    `https://${sourceStore}/products/${handle}.json`,
    { headers: { "User-Agent": "Mozilla/5.0" }, cache: "no-store" }
  );
  if (!productRes.ok) throw new Error(`Failed to fetch product: HTTP ${productRes.status}`);
  const productData = (await productRes.json()) as { product: ShopifyProduct };
  const product = productData.product;

  let title = product.title;
  let description = product.body_html || "";
  const originalDescription = description;

  // 2. Translate
  if (opts.translateEnabled && opts.language !== "en") {
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

  // 3. Enhance title
  if (opts.enhanceTitleEnabled) {
    try {
      const enhanced = await enhanceTitle(title, opts.language, product.product_type);
      if (enhanced && enhanced.length > 5) title = enhanced;
    } catch { /* keep current */ }
  }

  // 4. Enhance description
  if (opts.enhanceDescriptionEnabled) {
    try {
      const plain = description.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      const enhanced = await enhanceDescription(plain, title, opts.language);
      if (enhanced && enhanced.length > 10) description = enhanced;
    } catch { /* keep current */ }
  }

  if (description.replace(/<[^>]+>/g, "").trim().length < 10) {
    description = originalDescription || `<p>${title}</p>`;
  }

  // 5. Price
  let price = "29.95";
  const originalPrice = product.variants[0]?.price;
  if (opts.pricingMode === "original" && originalPrice) price = originalPrice;
  else if (opts.pricingMode === "markup" && originalPrice && opts.markupPercent !== undefined) {
    const base = parseFloat(originalPrice);
    if (!isNaN(base)) price = (base * (1 + opts.markupPercent / 100)).toFixed(2);
  } else if (opts.pricingMode === "fixed" && opts.fixedPrice) price = opts.fixedPrice;

  // 6. Process images
  const images: {
    role: string;
    originalUrl: string;
    resultBase64?: string;
    resultMime?: string;
    aiGenerated: boolean;
    error?: string;
  }[] = [];
  const imagesToProcess = product.images.slice(0, 3);

  for (let j = 0; j < imagesToProcess.length; j++) {
    const img = imagesToProcess[j];
    const role = DEFAULT_ROLES[j] ?? "hero";

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
          const prompt = composePrompt({
            preset,
            role,
            collection: opts.aiImageCollection,
            customPrompt: opts.aiImageCustomPrompt,
          });
          try {
            const edited = await editImage({ imageBase64: imgBase64, mimeType: imgMime, prompt });
            images.push({ role, originalUrl: img.src, resultBase64: edited.imageBase64, resultMime: edited.mimeType, aiGenerated: true });
            continue;
          } catch (aiErr) {
            const msg = aiErr instanceof Error ? aiErr.message : "AI failed";
            images.push({ role, originalUrl: img.src, resultBase64: imgBase64, resultMime: imgMime, aiGenerated: false, error: msg });
            continue;
          }
        }
      }
      images.push({ role, originalUrl: img.src, resultBase64: imgBase64, resultMime: imgMime, aiGenerated: false });
    } catch (err) {
      images.push({ role, originalUrl: img.src, aiGenerated: false, error: err instanceof Error ? err.message : "Failed" });
    }
  }

  return {
    title,
    description,
    price,
    vendor: product.vendor || "",
    productType: product.product_type || "",
    images,
  };
}
