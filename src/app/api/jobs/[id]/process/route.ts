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
import { saveImage } from "@/lib/storage";
import {
  claimNextSlot,
  updateSlotStatus,
  updateDraftData,
  updateDraftStatus,
  isDraftComplete,
  isJobSlotsComplete,
  recoverZombieSlots,
  getSlotsByDraft,
} from "@/lib/gallery";

export const runtime = "nodejs";
export const maxDuration = 300;

const BUDGET_MS = 270_000; // 270s budget within 300s maxDuration (Pro plan)
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
  if (job.status === "done" || job.status === "failed" || (job as { status: string }).status === "cancelled") {
    return NextResponse.json({ status: job.status, message: "Job already finished" });
  }

  // Detect gallery mode
  let isGallery = false;
  try {
    const parsedOpts = JSON.parse(job.options);
    isGallery = parsedOpts.mode === "gallery";
  } catch { /* not gallery */ }

  if (isGallery) {
    return processGallerySlot(jobId, startTime);
  } else {
    return processLegacyJob(jobId, job, startTime);
  }
}

// ═══════════════════════════════════════════════════════════════
// GALLERY MODE — 1 slot per invocation
// ═══════════════════════════════════════════════════════════════

async function processGallerySlot(jobId: string, startTime: number) {
  // Recover zombie slots stuck in 'generating' > 3 min
  const recovered = await recoverZombieSlots(jobId);
  if (recovered > 0) {
    console.log(`[gallery/process] Recovered ${recovered} zombie slot(s) for job ${jobId}`);
  }

  // Claim next pending slot (across all products)
  const claimed = await claimNextSlot(jobId);
  if (!claimed) {
    // No pending slots — check overall job completion
    const { complete, doneCount, failedCount, totalCount } = await isJobSlotsComplete(jobId);
    if (complete) {
      // Build results and finalize product-level tracking
      await finalizeGalleryJob(jobId);
    }
    return NextResponse.json({
      status: complete ? "done" : "processing",
      slots_done: doneCount,
      slots_failed: failedCount,
      slots_total: totalCount,
      processed_this_call: 0,
      recovered,
    });
  }

  const { slot, draft } = claimed;

  console.log(
    `[gallery/process] Processing slot ${slot.shot_type} (${slot.model_slug}) for ${draft.handle}`
  );

  // Scrape product data if draft doesn't have it yet
  let sourceBase64: string | undefined;
  let sourceMime: string | undefined;

  if (!draft.source_image_url) {
    try {
      const productRes = await fetchWithRetry(
        `https://${draft.source_store}/products/${draft.handle}.json`,
        { headers: { "User-Agent": "Mozilla/5.0" }, cache: "no-store" },
        3,
        30_000
      );
      if (productRes.ok) {
        const productData = (await productRes.json()) as { product: ShopifyProduct };
        const product = productData.product;
        const firstImg = product.images[0]?.src ?? null;

        await updateDraftData(draft.id, {
          title: product.title,
          description: product.body_html || "",
          price: product.variants[0]?.price ?? "29.95",
          vendor: product.vendor || "",
          product_type: product.product_type || "",
          source_image_url: firstImg,
        });
        await updateDraftStatus(draft.id, "processing");

        // Download source image
        if (firstImg) {
          const imgRes = await fetchWithRetry(
            firstImg,
            { headers: { "User-Agent": "Mozilla/5.0" } },
            3,
            30_000
          );
          if (imgRes.ok) {
            sourceBase64 = Buffer.from(await imgRes.arrayBuffer()).toString("base64");
            sourceMime = imgRes.headers.get("content-type") || "image/png";
          }
        }
      } else {
        await updateSlotStatus(slot.id, "failed", {
          error_message: `Scrape failed: HTTP ${productRes.status}`,
        });
        return NextResponse.json({
          status: "processing",
          processed_this_call: 1,
          slot_result: "failed",
          error: `Scrape failed: HTTP ${productRes.status}`,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Scrape error";
      await updateSlotStatus(slot.id, "failed", { error_message: msg });
      return NextResponse.json({
        status: "processing",
        processed_this_call: 1,
        slot_result: "failed",
        error: msg,
      });
    }
  } else {
    // Draft already scraped — download source image
    try {
      const imgRes = await fetchWithRetry(
        draft.source_image_url,
        { headers: { "User-Agent": "Mozilla/5.0" } },
        2,
        15_000
      );
      if (imgRes.ok) {
        sourceBase64 = Buffer.from(await imgRes.arrayBuffer()).toString("base64");
        sourceMime = imgRes.headers.get("content-type") || "image/png";
      }
    } catch { /* generate without source */ }
  }

  // Download character reference if slot has one
  let charRefBase64: string | undefined;
  let charRefMime: string | undefined;
  if (slot.character_ref_url) {
    try {
      const charRes = await fetchWithRetry(
        slot.character_ref_url,
        { headers: { "User-Agent": "Mozilla/5.0" } },
        2,
        15_000
      );
      if (charRes.ok) {
        charRefBase64 = Buffer.from(await charRes.arrayBuffer()).toString("base64");
        charRefMime = charRes.headers.get("content-type") || "image/png";
      }
    } catch {
      console.log(`[gallery/process] Could not download character ref for slot ${slot.shot_type}`);
    }
  }

  // Generate image for this slot
  try {
    const genStart = Date.now();
    const genResult = await generateImage({
      modelSlug: slot.model_slug,
      prompt: slot.prompt,
      sourceImageBase64: sourceBase64,
      sourceMimeType: sourceMime,
      referenceImageBase64: charRefBase64,
      referenceMimeType: charRefMime,
      fallbackModelSlug: "nano-banana-edit",
    });

    // Persist generated image to Vercel Blob
    let imageUrl: string;
    try {
      const blobPath = `gallery/${jobId}/${draft.id}/${slot.slot_order}-${slot.shot_type}`;
      imageUrl = await saveImage(genResult.imageBase64, genResult.mimeType, blobPath);
    } catch (blobErr) {
      const blobMsg = blobErr instanceof Error ? blobErr.message : "Blob upload failed";
      console.error(`[gallery/process] Blob save failed for slot ${slot.shot_type}: ${blobMsg}`);
      await updateSlotStatus(slot.id, "failed", { error_message: `Generated OK but Blob save failed: ${blobMsg}` });

      if (await isDraftComplete(draft.id)) {
        await updateDraftStatus(draft.id, "done");
        await markProductDoneFromDraft(jobId, draft);
      }
      return NextResponse.json({
        status: "processing",
        processed_this_call: 1,
        slot_result: "failed",
        error: blobMsg,
        elapsed_ms: Date.now() - startTime,
      });
    }

    await updateSlotStatus(slot.id, "done", {
      generated_image_url: imageUrl,
      credits_used: genResult.creditsUsed,
    });

    console.log(
      `[gallery/process] Slot ${slot.shot_type} done for ${draft.handle} in ${Date.now() - genStart}ms ` +
      `(requested=${slot.model_slug}, used=${genResult.modelUsed})`
    );

    // Check if this draft is now complete
    if (await isDraftComplete(draft.id)) {
      await updateDraftStatus(draft.id, "done");
      // Also mark in product_queue for the job-level UI
      await markProductDoneFromDraft(jobId, draft);
    }

    return NextResponse.json({
      status: "processing",
      processed_this_call: 1,
      slot_result: "done",
      model_used: genResult.modelUsed,
      elapsed_ms: Date.now() - startTime,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "AI generation failed";
    await updateSlotStatus(slot.id, "failed", { error_message: msg });
    console.error(`[gallery/process] Slot ${slot.shot_type} failed for ${draft.handle}: ${msg}`);

    if (await isDraftComplete(draft.id)) {
      await updateDraftStatus(draft.id, "done");
      await markProductDoneFromDraft(jobId, draft);
    }

    return NextResponse.json({
      status: "processing",
      processed_this_call: 1,
      slot_result: "failed",
      error: msg,
      elapsed_ms: Date.now() - startTime,
    });
  }
}

/** When all slots for a draft are complete, mark the product in the job queue as done */
async function markProductDoneFromDraft(jobId: string, draft: { id: string; handle: string }) {
  const job = await getJob(jobId);
  if (!job) return;

  const idx = job.product_queue.findIndex((p) => p.handle === draft.handle);
  if (idx === -1) return;

  // Read draft for scraped product data
  const { getDraft } = await import("@/lib/gallery");
  const fullDraft = await getDraft(draft.id);

  const slots = await getSlotsByDraft(draft.id);
  const images = slots.map((s) => ({
    role: s.shot_type,
    originalUrl: fullDraft?.source_image_url ?? "",
    resultUrl: s.generated_image_url ?? undefined, // Blob URL
    aiGenerated: s.status === "done" && !!s.generated_image_url,
    error: s.error_message ?? undefined,
  }));

  await markProductDone(jobId, idx, {
    title: fullDraft?.title ?? draft.handle,
    description: fullDraft?.description ?? "",
    price: fullDraft?.price ?? "29.95",
    vendor: fullDraft?.vendor ?? "",
    productType: fullDraft?.product_type ?? "",
    images: images as typeof job.product_queue[0]["images"],
  });
}

/** Finalize a gallery job — mark all remaining products as done/failed */
async function finalizeGalleryJob(jobId: string) {
  const job = await getJob(jobId);
  if (!job || job.status === "done" || job.status === "failed") return;

  // Find any products still in pending/processing and finalize them
  for (let i = 0; i < job.product_queue.length; i++) {
    const p = job.product_queue[i];
    if (p.status === "pending" || p.status === "processing") {
      await markProductDone(jobId, i, { title: p.handle });
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// LEGACY MODE — 1 product per invocation (unchanged)
// ═══════════════════════════════════════════════════════════════

async function processLegacyJob(
  jobId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  job: any,
  startTime: number
) {
  const recovered = await recoverZombieProducts(jobId);

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
  const opts: ImportOptions = JSON.parse(job.options);

  try {
    const result = await processLegacyProduct(product.handle, product.sourceStore, opts, startTime);
    await markProductDone(jobId, productIndex, result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
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
