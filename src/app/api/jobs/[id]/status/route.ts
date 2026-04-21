import { NextRequest, NextResponse } from "next/server";
import { getJob } from "@/lib/jobs";
import { getDraftsByJob, getSlotsByDraft } from "@/lib/gallery";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const job = await getJob(id);
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    // Detect gallery mode
    let isGallery = false;
    try {
      const parsed = JSON.parse(job.options);
      isGallery = parsed.mode === "gallery";
    } catch { /* not gallery */ }

    // Build per-product status
    const products = job.product_queue.map((p) => ({
      handle: p.handle,
      status: p.status,
      title: p.title,
      error: p.error,
      imageCount: p.images?.length ?? 0,
      aiGenerated: p.images?.some((img) => img.aiGenerated) ?? false,
    }));

    // For gallery jobs, also return slot-level detail
    let slots: {
      handle: string;
      slot_order: number;
      shot_type: string;
      status: string;
      model_slug: string;
      error?: string;
    }[] | undefined;

    if (isGallery) {
      const drafts = await getDraftsByJob(id);
      const allSlots: typeof slots = [];
      for (const draft of drafts) {
        const draftSlots = await getSlotsByDraft(draft.id);
        for (const s of draftSlots) {
          allSlots.push({
            handle: draft.handle,
            slot_order: s.slot_order,
            shot_type: s.shot_type,
            status: s.status,
            model_slug: s.model_slug,
            error: s.error_message ?? undefined,
          });
        }
      }
      slots = allSlots;
    }

    const slotCounts = slots ? {
      slots_total: slots.length,
      slots_done: slots.filter((s) => s.status === "done").length,
      slots_failed: slots.filter((s) => s.status === "failed").length,
      slots_generating: slots.filter((s) => s.status === "generating").length,
      slots_pending: slots.filter((s) => s.status === "pending").length,
    } : undefined;

    return NextResponse.json({
      id: job.id,
      status: job.status,
      mode: isGallery ? "gallery" : "legacy",
      total_products: job.total_products,
      completed_products: job.completed_products,
      failed_products: job.failed_products,
      products,
      slots,
      ...slotCounts,
      created_at: job.created_at,
      updated_at: job.updated_at,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
