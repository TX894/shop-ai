/**
 * Product gallery — drafts and per-slot image generation tracking.
 * Postgres in production, JSON file locally.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";

// ---------- Types ----------

export const SHOT_TYPES = [
  "hero",
  "detail_macro",
  "in_hand",
  "on_model",
  "in_box",
  "lifestyle",
  "scale_compare",
] as const;

export type ShotType = (typeof SHOT_TYPES)[number];

export interface ProductDraft {
  id: string;
  job_id: string;
  handle: string;
  source_store: string;
  title: string | null;
  description: string | null;
  price: string | null;
  vendor: string | null;
  product_type: string | null;
  source_image_url: string | null;
  status: "pending" | "processing" | "done" | "failed";
  created_at: string;
  updated_at: string;
}

export interface GallerySlot {
  id: string;
  product_draft_id: string;
  slot_order: number;
  shot_type: ShotType;
  prompt: string;
  model_slug: string;
  status: "pending" | "generating" | "done" | "failed";
  source_image_url: string | null;
  character_ref_url: string | null;
  generated_image_url: string | null;
  error_message: string | null;
  credits_used: number | null;
  created_at: string;
  updated_at: string;
}

export interface CreateDraftInput {
  job_id: string;
  handle: string;
  source_store: string;
  title?: string;
  source_image_url?: string;
}

export interface CreateSlotInput {
  product_draft_id: string;
  slot_order: number;
  shot_type: ShotType;
  prompt: string;
  model_slug: string;
  source_image_url?: string;
  character_ref_url?: string;
}

// ---------- Backend detection ----------

function usePostgres(): boolean {
  return !!process.env.POSTGRES_URL;
}

// ---------- Postgres schema ----------

const CREATE_DRAFTS_PG = `
  CREATE TABLE IF NOT EXISTS product_drafts (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id           UUID NOT NULL,
    handle           TEXT NOT NULL,
    source_store     TEXT NOT NULL,
    title            TEXT,
    description      TEXT,
    price            TEXT,
    vendor           TEXT,
    product_type     TEXT,
    source_image_url TEXT,
    status           TEXT NOT NULL DEFAULT 'pending',
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    updated_at       TIMESTAMPTZ DEFAULT NOW()
  )
`;

const CREATE_SLOTS_PG = `
  CREATE TABLE IF NOT EXISTS product_gallery_slots (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_draft_id    UUID NOT NULL REFERENCES product_drafts(id) ON DELETE CASCADE,
    slot_order          INT NOT NULL,
    shot_type           TEXT NOT NULL,
    prompt              TEXT NOT NULL,
    model_slug          TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'pending',
    source_image_url    TEXT,
    character_ref_url   TEXT,
    generated_image_url TEXT,
    error_message       TEXT,
    credits_used        INT,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
  )
`;

const CREATE_SLOTS_INDEX_PG = `
  CREATE INDEX IF NOT EXISTS idx_slots_draft
  ON product_gallery_slots (product_draft_id)
`;

let _pgGalleryMigrated = false;

async function ensurePgGallerySchema(): Promise<void> {
  if (_pgGalleryMigrated) return;
  const { sql } = await import("@vercel/postgres");
  await sql.query(CREATE_DRAFTS_PG);
  await sql.query(CREATE_SLOTS_PG);
  await sql.query(CREATE_SLOTS_INDEX_PG);
  _pgGalleryMigrated = true;
}

// ---------- Filesystem backend ----------

const DRAFTS_PATH = path.join(process.cwd(), "data", "product_drafts.json");
const SLOTS_PATH = path.join(process.cwd(), "data", "gallery_slots.json");

function fileRead<T>(p: string): T[] {
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf-8")) as T[];
  } catch { /* ignore */ }
  return [];
}

function fileWrite<T>(p: string, data: T[]): void {
  const dir = path.dirname(p);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

// ---------- Row mapping ----------

function rowToDraft(row: Record<string, unknown>): ProductDraft {
  return {
    id: String(row.id),
    job_id: String(row.job_id),
    handle: String(row.handle),
    source_store: String(row.source_store),
    title: row.title ? String(row.title) : null,
    description: row.description ? String(row.description) : null,
    price: row.price ? String(row.price) : null,
    vendor: row.vendor ? String(row.vendor) : null,
    product_type: row.product_type ? String(row.product_type) : null,
    source_image_url: row.source_image_url ? String(row.source_image_url) : null,
    status: String(row.status) as ProductDraft["status"],
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function rowToSlot(row: Record<string, unknown>): GallerySlot {
  return {
    id: String(row.id),
    product_draft_id: String(row.product_draft_id),
    slot_order: Number(row.slot_order),
    shot_type: String(row.shot_type) as ShotType,
    prompt: String(row.prompt),
    model_slug: String(row.model_slug),
    status: String(row.status) as GallerySlot["status"],
    source_image_url: row.source_image_url ? String(row.source_image_url) : null,
    character_ref_url: row.character_ref_url ? String(row.character_ref_url) : null,
    generated_image_url: row.generated_image_url ? String(row.generated_image_url) : null,
    error_message: row.error_message ? String(row.error_message) : null,
    credits_used: row.credits_used != null ? Number(row.credits_used) : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

// ---------- Product Drafts API ----------

export async function createDraft(input: CreateDraftInput): Promise<ProductDraft> {
  if (usePostgres()) {
    await ensurePgGallerySchema();
    const { sql } = await import("@vercel/postgres");
    const result = await sql.query(
      `INSERT INTO product_drafts (job_id, handle, source_store, title, source_image_url)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [input.job_id, input.handle, input.source_store, input.title ?? null, input.source_image_url ?? null]
    );
    return rowToDraft(result.rows[0]);
  }

  const drafts = fileRead<ProductDraft>(DRAFTS_PATH);
  const now = new Date().toISOString();
  const draft: ProductDraft = {
    id: crypto.randomUUID(),
    job_id: input.job_id,
    handle: input.handle,
    source_store: input.source_store,
    title: input.title ?? null,
    description: null,
    price: null,
    vendor: null,
    product_type: null,
    source_image_url: input.source_image_url ?? null,
    status: "pending",
    created_at: now,
    updated_at: now,
  };
  drafts.push(draft);
  fileWrite(DRAFTS_PATH, drafts);
  return draft;
}

export async function getDraftsByJob(jobId: string): Promise<ProductDraft[]> {
  if (usePostgres()) {
    await ensurePgGallerySchema();
    const { sql } = await import("@vercel/postgres");
    const result = await sql.query(
      "SELECT * FROM product_drafts WHERE job_id = $1 ORDER BY created_at ASC",
      [jobId]
    );
    return result.rows.map(rowToDraft);
  }
  return fileRead<ProductDraft>(DRAFTS_PATH).filter((d) => d.job_id === jobId);
}

export async function getDraft(id: string): Promise<ProductDraft | null> {
  if (usePostgres()) {
    await ensurePgGallerySchema();
    const { sql } = await import("@vercel/postgres");
    const result = await sql.query("SELECT * FROM product_drafts WHERE id = $1", [id]);
    return result.rows[0] ? rowToDraft(result.rows[0]) : null;
  }
  return fileRead<ProductDraft>(DRAFTS_PATH).find((d) => d.id === id) ?? null;
}

export async function updateDraftStatus(
  id: string,
  status: ProductDraft["status"]
): Promise<void> {
  if (usePostgres()) {
    const { sql } = await import("@vercel/postgres");
    await sql.query(
      "UPDATE product_drafts SET status = $1, updated_at = NOW() WHERE id = $2",
      [status, id]
    );
    return;
  }
  const drafts = fileRead<ProductDraft>(DRAFTS_PATH);
  const d = drafts.find((x) => x.id === id);
  if (d) { d.status = status; d.updated_at = new Date().toISOString(); }
  fileWrite(DRAFTS_PATH, drafts);
}

// ---------- Gallery Slots API ----------

export async function createSlot(input: CreateSlotInput): Promise<GallerySlot> {
  if (usePostgres()) {
    await ensurePgGallerySchema();
    const { sql } = await import("@vercel/postgres");
    const result = await sql.query(
      `INSERT INTO product_gallery_slots
        (product_draft_id, slot_order, shot_type, prompt, model_slug, source_image_url, character_ref_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        input.product_draft_id,
        input.slot_order,
        input.shot_type,
        input.prompt,
        input.model_slug,
        input.source_image_url ?? null,
        input.character_ref_url ?? null,
      ]
    );
    return rowToSlot(result.rows[0]);
  }

  const slots = fileRead<GallerySlot>(SLOTS_PATH);
  const now = new Date().toISOString();
  const slot: GallerySlot = {
    id: crypto.randomUUID(),
    product_draft_id: input.product_draft_id,
    slot_order: input.slot_order,
    shot_type: input.shot_type,
    prompt: input.prompt,
    model_slug: input.model_slug,
    status: "pending",
    source_image_url: input.source_image_url ?? null,
    character_ref_url: input.character_ref_url ?? null,
    generated_image_url: null,
    error_message: null,
    credits_used: null,
    created_at: now,
    updated_at: now,
  };
  slots.push(slot);
  fileWrite(SLOTS_PATH, slots);
  return slot;
}

export async function getSlotsByDraft(draftId: string): Promise<GallerySlot[]> {
  if (usePostgres()) {
    await ensurePgGallerySchema();
    const { sql } = await import("@vercel/postgres");
    const result = await sql.query(
      "SELECT * FROM product_gallery_slots WHERE product_draft_id = $1 ORDER BY slot_order ASC",
      [draftId]
    );
    return result.rows.map(rowToSlot);
  }
  return fileRead<GallerySlot>(SLOTS_PATH)
    .filter((s) => s.product_draft_id === draftId)
    .sort((a, b) => a.slot_order - b.slot_order);
}

export async function getSlot(id: string): Promise<GallerySlot | null> {
  if (usePostgres()) {
    await ensurePgGallerySchema();
    const { sql } = await import("@vercel/postgres");
    const result = await sql.query(
      "SELECT * FROM product_gallery_slots WHERE id = $1",
      [id]
    );
    return result.rows[0] ? rowToSlot(result.rows[0]) : null;
  }
  return fileRead<GallerySlot>(SLOTS_PATH).find((s) => s.id === id) ?? null;
}

export async function updateSlotStatus(
  id: string,
  status: GallerySlot["status"],
  extra?: { generated_image_url?: string; error_message?: string; credits_used?: number }
): Promise<void> {
  if (usePostgres()) {
    const { sql } = await import("@vercel/postgres");
    const sets = ["status = $1", "updated_at = NOW()"];
    const vals: unknown[] = [status];
    let idx = 2;

    if (extra?.generated_image_url !== undefined) {
      sets.push(`generated_image_url = $${idx++}`);
      vals.push(extra.generated_image_url);
    }
    if (extra?.error_message !== undefined) {
      sets.push(`error_message = $${idx++}`);
      vals.push(extra.error_message);
    }
    if (extra?.credits_used !== undefined) {
      sets.push(`credits_used = $${idx++}`);
      vals.push(extra.credits_used);
    }
    vals.push(id);
    await sql.query(
      `UPDATE product_gallery_slots SET ${sets.join(", ")} WHERE id = $${idx}`,
      vals
    );
    return;
  }

  const slots = fileRead<GallerySlot>(SLOTS_PATH);
  const s = slots.find((x) => x.id === id);
  if (s) {
    s.status = status;
    if (extra?.generated_image_url !== undefined) s.generated_image_url = extra.generated_image_url;
    if (extra?.error_message !== undefined) s.error_message = extra.error_message;
    if (extra?.credits_used !== undefined) s.credits_used = extra.credits_used;
    s.updated_at = new Date().toISOString();
  }
  fileWrite(SLOTS_PATH, slots);
}

/** Get all slots for a job (across all drafts) */
export async function getSlotsByJob(jobId: string): Promise<GallerySlot[]> {
  const drafts = await getDraftsByJob(jobId);
  const allSlots: GallerySlot[] = [];
  for (const d of drafts) {
    const slots = await getSlotsByDraft(d.id);
    allSlots.push(...slots);
  }
  return allSlots;
}

/** Claim the next pending slot across all drafts in a job. Returns slot + its draft. */
export async function claimNextSlot(
  jobId: string
): Promise<{ slot: GallerySlot; draft: ProductDraft } | null> {
  const drafts = await getDraftsByJob(jobId);
  for (const draft of drafts) {
    const slots = await getSlotsByDraft(draft.id);
    const pending = slots.find((s) => s.status === "pending");
    if (pending) {
      await updateSlotStatus(pending.id, "generating");
      return { slot: { ...pending, status: "generating" }, draft };
    }
  }
  return null;
}

/** Update draft with scraped product data */
export async function updateDraftData(
  id: string,
  data: {
    title?: string;
    description?: string;
    price?: string;
    vendor?: string;
    product_type?: string;
    source_image_url?: string;
  }
): Promise<void> {
  if (usePostgres()) {
    await ensurePgGallerySchema();
    const { sql } = await import("@vercel/postgres");
    const sets: string[] = ["updated_at = NOW()"];
    const vals: unknown[] = [];
    let idx = 1;
    if (data.title !== undefined) { sets.push(`title = $${idx++}`); vals.push(data.title); }
    if (data.description !== undefined) { sets.push(`description = $${idx++}`); vals.push(data.description); }
    if (data.price !== undefined) { sets.push(`price = $${idx++}`); vals.push(data.price); }
    if (data.vendor !== undefined) { sets.push(`vendor = $${idx++}`); vals.push(data.vendor); }
    if (data.product_type !== undefined) { sets.push(`product_type = $${idx++}`); vals.push(data.product_type); }
    if (data.source_image_url !== undefined) { sets.push(`source_image_url = $${idx++}`); vals.push(data.source_image_url); }
    vals.push(id);
    await sql.query(
      `UPDATE product_drafts SET ${sets.join(", ")} WHERE id = $${idx}`,
      vals
    );
    return;
  }
  const drafts = fileRead<ProductDraft>(DRAFTS_PATH);
  const d = drafts.find((x) => x.id === id);
  if (d) {
    if (data.title !== undefined) d.title = data.title;
    if (data.description !== undefined) d.description = data.description;
    if (data.price !== undefined) d.price = data.price;
    if (data.vendor !== undefined) d.vendor = data.vendor;
    if (data.product_type !== undefined) d.product_type = data.product_type;
    if (data.source_image_url !== undefined) d.source_image_url = data.source_image_url;
    d.updated_at = new Date().toISOString();
  }
  fileWrite(DRAFTS_PATH, drafts);
}

/** Check if all slots for a draft are complete (done or failed) */
export async function isDraftComplete(draftId: string): Promise<boolean> {
  const slots = await getSlotsByDraft(draftId);
  return slots.every((s) => s.status === "done" || s.status === "failed");
}

/** Check if all drafts in a job have all slots complete */
export async function isJobSlotsComplete(
  jobId: string
): Promise<{ complete: boolean; doneCount: number; failedCount: number; totalCount: number }> {
  const allSlots = await getSlotsByJob(jobId);
  const doneCount = allSlots.filter((s) => s.status === "done").length;
  const failedCount = allSlots.filter((s) => s.status === "failed").length;
  return {
    complete: allSlots.every((s) => s.status === "done" || s.status === "failed"),
    doneCount,
    failedCount,
    totalCount: allSlots.length,
  };
}

/** Reset zombie slots (generating > 3 min) back to pending */
export async function recoverZombieSlots(jobId: string): Promise<number> {
  const allSlots = await getSlotsByJob(jobId);
  const now = Date.now();
  let recovered = 0;
  for (const slot of allSlots) {
    if (slot.status !== "generating") continue;
    const updatedAt = new Date(slot.updated_at).getTime();
    if (now - updatedAt > 3 * 60 * 1000) {
      await updateSlotStatus(slot.id, "pending", { error_message: undefined });
      recovered++;
    }
  }
  return recovered;
}
