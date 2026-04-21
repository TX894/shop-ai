import { NextRequest, NextResponse } from "next/server";
import { createJob } from "@/lib/jobs";
import { createDraft, createSlot } from "@/lib/gallery";
import { getActiveStore } from "@/lib/stores";
import type { ShotType } from "@/lib/gallery";

export const runtime = "nodejs";

interface SlotTemplate {
  shot_type: ShotType;
  model_slug: string;
  prompt: string;
}

interface CreateGalleryJobBody {
  source_store: string;
  selected_handles: string[];
  gallery_template: SlotTemplate[];
  options?: Record<string, unknown>;
}

export async function POST(req: NextRequest) {
  let body: CreateGalleryJobBody;
  try {
    body = (await req.json()) as CreateGalleryJobBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (
    !body.source_store ||
    !body.selected_handles?.length ||
    !body.gallery_template?.length
  ) {
    return NextResponse.json(
      { error: "source_store, selected_handles, and gallery_template are required" },
      { status: 400 }
    );
  }

  try {
    const store = await getActiveStore();
    const characterRefUrl = store?.character_reference_url ?? null;

    // Create the import job
    const job = await createJob({
      store_id: store?.id,
      products: body.selected_handles.map((handle) => ({
        handle,
        sourceStore: body.source_store,
      })),
      options: JSON.stringify({
        ...body.options,
        mode: "gallery",
        source_store: body.source_store,
        slot_count: body.gallery_template.length,
      }),
    });

    // Create drafts and slots for each product
    for (const handle of body.selected_handles) {
      const draft = await createDraft({
        job_id: job.id,
        handle,
        source_store: body.source_store,
      });

      for (let i = 0; i < body.gallery_template.length; i++) {
        const tmpl = body.gallery_template[i];
        const needsCharacter = ["in_hand", "on_model"].includes(tmpl.shot_type);

        await createSlot({
          product_draft_id: draft.id,
          slot_order: i,
          shot_type: tmpl.shot_type,
          prompt: tmpl.prompt,
          model_slug: tmpl.model_slug,
          character_ref_url: needsCharacter && characterRefUrl ? characterRefUrl : undefined,
        });
      }
    }

    return NextResponse.json({ jobId: job.id }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
