import { NextRequest, NextResponse } from "next/server";
import { getDraft, getDraftsByJob, getSlotsByDraft, updateDraftStatus } from "@/lib/gallery";
import { graphql } from "@/lib/shopify-admin";
import { getStoreDomain } from "@/lib/shopify-auth";

export const runtime = "nodejs";
export const maxDuration = 300;

interface PushBody {
  draft_ids?: string[];
  job_id?: string;
  handles?: string[];
  product_status?: "DRAFT" | "ACTIVE";
}

interface PushResult {
  draftId: string;
  handle: string;
  success: boolean;
  shopifyProductId?: string;
  adminUrl?: string;
  imagesUploaded?: number;
  error?: string;
}

export async function POST(req: NextRequest) {
  let body: PushBody;
  try {
    body = (await req.json()) as PushBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Resolve draft IDs from either direct list or job_id + handles
  let draftIds = body.draft_ids ?? [];
  if (!draftIds.length && body.job_id) {
    const drafts = await getDraftsByJob(body.job_id);
    const handleSet = body.handles ? new Set(body.handles) : null;
    draftIds = drafts
      .filter((d) => !handleSet || handleSet.has(d.handle))
      .map((d) => d.id);
  }

  if (!draftIds.length) {
    return NextResponse.json({ error: "draft_ids[] or job_id required" }, { status: 400 });
  }

  const status = body.product_status ?? "DRAFT";
  const results: PushResult[] = [];

  for (const draftId of draftIds) {
    const draft = await getDraft(draftId);
    if (!draft) {
      results.push({ draftId, handle: "unknown", success: false, error: "Draft not found" });
      continue;
    }

    try {
      const slots = await getSlotsByDraft(draftId);
      const approvedSlots = slots.filter(
        (s) => s.status === "done" && s.generated_image_url && !s.generated_image_url.startsWith("generated:")
      );

      if (approvedSlots.length === 0) {
        results.push({
          draftId,
          handle: draft.handle,
          success: false,
          error: "No approved images with generated URLs",
        });
        continue;
      }

      // 1. Create product on Shopify
      const createData = await graphql<{
        productCreate: {
          product: { id: string; handle: string; status: string } | null;
          userErrors: { field: string[]; message: string }[];
        };
      }>(
        `mutation productCreate($input: ProductInput!) {
          productCreate(input: $input) {
            product { id handle status }
            userErrors { field message }
          }
        }`,
        {
          input: {
            title: draft.title ?? draft.handle,
            descriptionHtml: draft.description ?? "",
            vendor: draft.vendor ?? "",
            productType: draft.product_type ?? "",
            status,
          },
        }
      );

      const createErrors = createData.productCreate.userErrors;
      if (createErrors.length > 0) {
        results.push({
          draftId,
          handle: draft.handle,
          success: false,
          error: createErrors.map((e) => e.message).join("; "),
        });
        continue;
      }

      const product = createData.productCreate.product;
      if (!product) {
        results.push({ draftId, handle: draft.handle, success: false, error: "No product returned" });
        continue;
      }

      // 2. Upload each approved slot image (in slot_order)
      let imagesUploaded = 0;
      for (const slot of approvedSlots) {
        try {
          // Staged upload flow
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
                  url resourceUrl
                  parameters { name value }
                }
                userErrors { field message }
              }
            }`,
            {
              input: [
                {
                  resource: "PRODUCT_IMAGE",
                  filename: `${slot.shot_type}-${slot.slot_order}.png`,
                  mimeType: "image/png",
                  httpMethod: "POST",
                },
              ],
            }
          );

          const target = stagedData.stagedUploadsCreate.stagedTargets[0];
          if (!target) continue;

          // Download image from Blob URL and upload to Shopify
          const imgRes = await fetch(slot.generated_image_url!);
          if (!imgRes.ok) continue;
          const imgBuffer = await imgRes.arrayBuffer();

          const formData = new FormData();
          for (const param of target.parameters) {
            formData.append(param.name, param.value);
          }
          formData.append(
            "file",
            new Blob([new Uint8Array(imgBuffer)], { type: "image/png" }),
            `${slot.shot_type}.png`
          );

          const uploadRes = await fetch(target.url, { method: "POST", body: formData });
          if (!uploadRes.ok) continue;

          // Attach to product
          await graphql(
            `mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
              productCreateMedia(productId: $productId, media: $media) {
                media { ... on MediaImage { id status } }
                mediaUserErrors { field message }
              }
            }`,
            {
              productId: product.id,
              media: [
                {
                  originalSource: target.resourceUrl,
                  mediaContentType: "IMAGE",
                  alt: `${draft.title ?? draft.handle} - ${slot.shot_type}`,
                },
              ],
            }
          );

          imagesUploaded++;
        } catch (imgErr) {
          console.error(
            `[gallery/push] Image upload failed for slot ${slot.shot_type}: ${imgErr instanceof Error ? imgErr.message : imgErr}`
          );
        }
      }

      const domain = await getStoreDomain();
      const numericId = product.id.split("/").pop();
      const adminUrl = `https://${domain}/admin/products/${numericId}`;

      await updateDraftStatus(draftId, "done");

      results.push({
        draftId,
        handle: draft.handle,
        success: true,
        shopifyProductId: product.id,
        adminUrl,
        imagesUploaded,
      });
    } catch (err) {
      results.push({
        draftId,
        handle: draft.handle,
        success: false,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  const successCount = results.filter((r) => r.success).length;
  return NextResponse.json({
    total: results.length,
    success: successCount,
    failed: results.length - successCount,
    results,
  });
}
