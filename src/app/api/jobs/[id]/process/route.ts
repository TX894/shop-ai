import { NextRequest, NextResponse } from "next/server";
import {
  claimNextProduct,
  markProductDone,
  markProductFailed,
  recoverZombieProducts,
  getJob,
} from "@/lib/jobs";
import type { ImportOptions } from "@/types/import";
import type { ShopifyProduct } from "@/types/shopify";
import type { ImageRole } from "@/types/preset";
import { translateText, enhanceTitle, enhanceDescription } from "@/lib/translation-service";
import { getPreset, composePrompt } from "@/lib/prompt-engine";
import { generateImage } from "@/lib/image-generation";
import { fetchWithRetry } from "@/lib/fetch-utils";
import {
  getDraftsByJob,
  getSlotsByDraft,
  updateSlotStatus,
  updateDraftStatus,
} from "@/lib/gallery";

export const runtime = "nodejs";
export const maxDuration = 60;

const BUDGET_MS = 50_000;
const DEFAULT_ROLES: ImageRole[] = ["hero", "detail", "lifestyle"];

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const startTime = Date.now();
  const { id: jobId } = await params;

  const job = await getJob(jobId);
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  if (job.status === "done" || job.status === "failed") {
    return NextResponse.json({ status: job.status, message: "Job already finished" });
  }

  const recovered = await recoverZombieProducts(jobId);
  if (recovered > 0) {
    console.log(`[jobs/process] Recovered ${recovered} zombie product(s) for job ${jobId}`);
  }

  // Detect gallery mode
  let isGallery = false;
  try {
    const parsedOpts = JSON.parse(job.options);
    isGallery = parsedOpts.mode === "gallery";
  } catch { /* not gallery */ }

  // Claim next product
  const claimed = await claimNextProduct(jobId);
  if (!claimed) {
    const updated = await getJob(jobId);
    return NextResponse.json({
      status: updated?.status ?? "unknown",
      completed: updated?.completed_products ?? 0,
      failed: updated?.failed_products ?? 0,
      total: updated?.total_products ?? 0,
      processed_this_call: 0,
      recovered,
    });
  }

  const { productIndex } = claimed;
  const product = claimed.job.product_queue[productIndex];

  try {
    let result;
    if (isGallery) {
      result = await processGalleryProduct(jobId, product.handle, product.sourceStore, startTime);
    } else {
      const opts: ImportOptions = JSON.parse(claimed.job.options);
      result = await processLegacyProduct(product.handle, product.sourceStore, opts, startTime);
    }
    await markProductDone(jobId, productIndex, result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[jobs/process] Product ${product.handle} failed: ${msg}`);
    await markProductFailed(jobId, productIndex, msg);
  }

  const updated = await getJob(jobId);
  return NextResponse.json({
    status: updated?.status ?? "unknown",
    completed: updated?.completed_products ?? 0,
    failed: updated?.failed_products ?? 0,
    total: updated?.total_products ?? 0,
    processed_this_call: 1,
    recovered,
    elapsed_ms: Date.now() - startTime,
  });
}

function budgetExceeded(startTime: number): boolean {
  return Date.now() - startTime > BUDGET_MS;
}

// ═══════════════════════════════════════════════════════════════
// GALLERY MODE — reads per-slot prompts/models from gallery_slots
// ═══════════════════════════════════════════════════════════════

async function processGalleryProduct(
  jobId: string,
  handle: string,
  sourceStore: string,
  startTime: number
) {
  // 1. Find the draft for this product
  const drafts = await getDraftsByJob(jobId);
  const draft = drafts.find((d) => d.handle === handle);
  if (!draft) throw new Error(`No draft found for handle ${handle}`);

  await updateDraftStatus(draft.id, "processing");

  // 2. Scrape product data
  const productRes = await fetchWithRetry(
    `https://${sourceStore}/products/${handle}.json`,
    { headers: { "User-Agent": "Mozilla/5.0" }, cache: "no-store" },
    3,
    30_000
  );
  if (!productRes.ok) {
    await updateDraftStatus(draft.id, "failed");
    throw new Error(`Failed to fetch product: HTTP ${productRes.status}`);
  }
  const productData = (await productRes.json()) as { product: ShopifyProduct };
  const product = productData.product;

  // 3. Download source image (first product image)
  const sourceImg = product.images[0];
  let sourceBase64: string | undefined;
  let sourceMime: string | undefined;

  if (sourceImg) {
    try {
      const imgRes = await fetchWithRetry(
        sourceImg.src,
        { headers: { "User-Agent": "Mozilla/5.0" } },
        3,
        30_000
      );
      if (imgRes.ok) {
        const buf = Buffer.from(await imgRes.arrayBuffer());
        sourceBase64 = buf.toString("base64");
        sourceMime = imgRes.headers.get("content-type") || "image/png";
      }
    } catch { /* continue without source image */ }
  }

  // 4. Process each gallery slot
  const slots = await getSlotsByDraft(draft.id);
  const resultImages: {
    role: string;
    originalUrl: string;
    resultBase64?: string;
    resultMime?: string;
    aiGenerated: boolean;
    error?: string;
  }[] = [];

  for (const slot of slots) {
    if (budgetExceeded(startTime)) {
      await updateSlotStatus(slot.id, "failed", {
        error_message: "Skipped: time budget exceeded",
      });
      resultImages.push({
        role: slot.shot_type,
        originalUrl: sourceImg?.src ?? "",
        aiGenerated: false,
        error: "Skipped: time budget exceeded",
      });
      continue;
    }

    await updateSlotStatus(slot.id, "generating");

    try {
      const genStart = Date.now();
      const genResult = await generateImage({
        modelSlug: slot.model_slug,
        prompt: slot.prompt,
        sourceImageBase64: sourceBase64,
        sourceMimeType: sourceMime,
      });

      await updateSlotStatus(slot.id, "done", {
        generated_image_url: `data:${genResult.mimeType};base64,${genResult.imageBase64.slice(0, 50)}...`, // Store a marker; full data in results
        credits_used: genResult.creditsUsed,
      });

      resultImages.push({
        role: slot.shot_type,
        originalUrl: sourceImg?.src ?? "",
        resultBase64: genResult.imageBase64,
        resultMime: genResult.mimeType,
        aiGenerated: true,
      });

      console.log(
        `[jobs/process] Slot ${slot.shot_type} done for ${handle} in ${Date.now() - genStart}ms (${slot.model_slug})`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "AI generation failed";
      await updateSlotStatus(slot.id, "failed", { error_message: msg });
      resultImages.push({
        role: slot.shot_type,
        originalUrl: sourceImg?.src ?? "",
        aiGenerated: false,
        error: msg,
      });
      console.error(`[jobs/process] Slot ${slot.shot_type} failed for ${handle}: ${msg}`);
    }
  }

  await updateDraftStatus(draft.id, "done");

  return {
    title: product.title,
    description: product.body_html || "",
    price: product.variants[0]?.price ?? "29.95",
    vendor: product.vendor || "",
    productType: product.product_type || "",
    images: resultImages,
  };
}

// ═══════════════════════════════════════════════════════════════
// LEGACY MODE — original ImportOptions-based flow
// ═══════════════════════════════════════════════════════════════

async function processLegacyProduct(
  handle: string,
  sourceStore: string,
  opts: ImportOptions,
  startTime: number
) {
  const productRes = await fetchWithRetry(
    `https://${sourceStore}/products/${handle}.json`,
    { headers: { "User-Agent": "Mozilla/5.0" }, cache: "no-store" },
    3,
    30_000
  );
  if (!productRes.ok) {
    throw new Error(`Failed to fetch product: HTTP ${productRes.status} after retries`);
  }
  const productData = (await productRes.json()) as { product: ShopifyProduct };
  const product = productData.product;

  let title = product.title;
  let description = product.body_html || "";
  const originalDescription = description;

  if (opts.translateEnabled && opts.language !== "en" && !budgetExceeded(startTime)) {
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

  if (opts.enhanceTitleEnabled && !budgetExceeded(startTime)) {
    try {
      const enhanced = await enhanceTitle(title, opts.language, product.product_type);
      if (enhanced && enhanced.length > 5) title = enhanced;
    } catch { /* keep current */ }
  }

  if (opts.enhanceDescriptionEnabled && !budgetExceeded(startTime)) {
    try {
      const plain = description.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      const enhanced = await enhanceDescription(plain, title, opts.language);
      if (enhanced && enhanced.length > 10) description = enhanced;
    } catch { /* keep current */ }
  }

  if (description.replace(/<[^>]+>/g, "").trim().length < 10) {
    description = originalDescription || `<p>${title}</p>`;
  }

  let price = "29.95";
  const originalPrice = product.variants[0]?.price;
  if (opts.pricingMode === "original" && originalPrice) price = originalPrice;
  else if (opts.pricingMode === "markup" && originalPrice && opts.markupPercent !== undefined) {
    const base = parseFloat(originalPrice);
    if (!isNaN(base)) price = (base * (1 + opts.markupPercent / 100)).toFixed(2);
  } else if (opts.pricingMode === "fixed" && opts.fixedPrice) price = opts.fixedPrice;

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

    if (budgetExceeded(startTime)) {
      images.push({ role, originalUrl: img.src, aiGenerated: false, error: "Skipped: time budget exceeded" });
      continue;
    }

    try {
      const imgRes = await fetchWithRetry(img.src, { headers: { "User-Agent": "Mozilla/5.0" } }, 3, 30_000);
      if (!imgRes.ok) {
        images.push({ role, originalUrl: img.src, aiGenerated: false, error: `Download failed: ${imgRes.status}` });
        continue;
      }
      const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
      const imgBase64 = imgBuffer.toString("base64");
      const imgMime = imgRes.headers.get("content-type") || "image/png";

      if (opts.aiImagesEnabled && opts.aiImagePresetId && !budgetExceeded(startTime)) {
        const preset = await getPreset(opts.aiImagePresetId);
        if (preset) {
          const prompt = composePrompt({ preset, role, collection: opts.aiImageCollection, customPrompt: opts.aiImageCustomPrompt });
          try {
            const genResult = await generateImage({ modelSlug: opts.imageModel, prompt, sourceImageBase64: imgBase64, sourceMimeType: imgMime });
            images.push({ role, originalUrl: img.src, resultBase64: genResult.imageBase64, resultMime: genResult.mimeType, aiGenerated: true });
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

  return { title, description, price, vendor: product.vendor || "", productType: product.product_type || "", images };
}
