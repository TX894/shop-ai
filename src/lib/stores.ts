/**
 * Multi-store management — Vercel Postgres in production, JSON file locally.
 * Detection: if POSTGRES_URL is set, use Postgres; otherwise filesystem.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";

// ---------- Types ----------

export interface Store {
  id: string;
  name: string;
  domain: string;
  client_id: string;
  client_secret: string;
  access_token: string | null;
  token_expires_at: string | null;
  is_active: boolean;
  character_reference_url: string | null;
  character_description: string | null;
  gallery_default_count: number;
  // ── Brand / SEO intelligence ────────────────────────────
  /** What the store sells, in one paragraph. The AI uses this to anchor titles + descriptions. */
  brand_brief: string | null;
  /** Comma-separated list of niches/categories (e.g. "luxury watches, men's fashion"). */
  niche: string | null;
  /** Target audience description (age, lifestyle, motivations, pain points). */
  target_audience: string | null;
  /** Brand voice / tone-of-voice (e.g. "Confident, succinct, premium. No hype words."). */
  brand_voice: string | null;
  /** Key value propositions / what differentiates the store. */
  value_props: string | null;
  /** Default language for new product copy (ISO 639-1 like "pt", "en"). */
  default_language: string | null;
  /** Currency symbol or code (e.g. "£", "EUR"). Default "£" for backwards compatibility. */
  currency: string | null;
  /** Vercel Blob URL for the store's logo image (PNG with alpha recommended). */
  logo_url: string | null;
  /** Short brand text used as a fallback watermark when no logo exists, or as the store URL on the watermark strip. */
  brand_short_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateStoreInput {
  name: string;
  domain: string;
  client_id: string;
  client_secret: string;
}

export interface UpdateStoreInput {
  name?: string;
  domain?: string;
  client_id?: string;
  client_secret?: string;
  character_reference_url?: string | null;
  character_description?: string | null;
  gallery_default_count?: number;
  brand_brief?: string | null;
  niche?: string | null;
  target_audience?: string | null;
  brand_voice?: string | null;
  value_props?: string | null;
  default_language?: string | null;
  currency?: string | null;
  logo_url?: string | null;
  brand_short_name?: string | null;
}

// ---------- Backend detection ----------

function usePostgres(): boolean {
  return !!process.env.POSTGRES_URL;
}

// ---------- Postgres schema ----------

const CREATE_STORES_TABLE_PG = `
  CREATE TABLE IF NOT EXISTS stores (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name             TEXT NOT NULL,
    domain           TEXT NOT NULL UNIQUE,
    client_id        TEXT NOT NULL,
    client_secret    TEXT NOT NULL,
    access_token     TEXT,
    token_expires_at TIMESTAMPTZ,
    is_active        BOOLEAN DEFAULT false,
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    updated_at       TIMESTAMPTZ DEFAULT NOW()
  )
`;

const CREATE_ACTIVE_INDEX_PG = `
  CREATE UNIQUE INDEX IF NOT EXISTS one_active_store
  ON stores (is_active) WHERE is_active = true
`;

let _pgStoresMigrated = false;

const ALTER_STORES_GALLERY_PG = `
  ALTER TABLE stores
    ADD COLUMN IF NOT EXISTS character_reference_url TEXT,
    ADD COLUMN IF NOT EXISTS character_description TEXT,
    ADD COLUMN IF NOT EXISTS gallery_default_count INT DEFAULT 4
`;

const ALTER_STORES_BRAND_PG = `
  ALTER TABLE stores
    ADD COLUMN IF NOT EXISTS brand_brief TEXT,
    ADD COLUMN IF NOT EXISTS niche TEXT,
    ADD COLUMN IF NOT EXISTS target_audience TEXT,
    ADD COLUMN IF NOT EXISTS brand_voice TEXT,
    ADD COLUMN IF NOT EXISTS value_props TEXT,
    ADD COLUMN IF NOT EXISTS default_language TEXT,
    ADD COLUMN IF NOT EXISTS currency TEXT,
    ADD COLUMN IF NOT EXISTS logo_url TEXT,
    ADD COLUMN IF NOT EXISTS brand_short_name TEXT
`;

async function ensurePgStoresSchema(): Promise<void> {
  if (_pgStoresMigrated) return;
  const { sql } = await import("@vercel/postgres");
  await sql.query(CREATE_STORES_TABLE_PG);
  await sql.query(CREATE_ACTIVE_INDEX_PG);
  await sql.query(ALTER_STORES_GALLERY_PG);
  await sql.query(ALTER_STORES_BRAND_PG);
  _pgStoresMigrated = true;
}

// ---------- Filesystem backend ----------

const STORES_PATH = path.join(process.cwd(), "data", "stores.json");

function fileReadStores(): Store[] {
  try {
    if (fs.existsSync(STORES_PATH)) {
      return JSON.parse(fs.readFileSync(STORES_PATH, "utf-8")) as Store[];
    }
  } catch {
    /* ignore */
  }
  return [];
}

function fileWriteStores(stores: Store[]): void {
  const dir = path.dirname(STORES_PATH);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STORES_PATH, JSON.stringify(stores, null, 2));
}

// ---------- Row mapping ----------

function rowToStore(row: Record<string, unknown>): Store {
  return {
    id: String(row.id),
    name: String(row.name),
    domain: String(row.domain),
    client_id: String(row.client_id),
    client_secret: String(row.client_secret),
    access_token: row.access_token ? String(row.access_token) : null,
    token_expires_at: row.token_expires_at ? String(row.token_expires_at) : null,
    is_active: Boolean(row.is_active),
    character_reference_url: row.character_reference_url ? String(row.character_reference_url) : null,
    character_description: row.character_description ? String(row.character_description) : null,
    gallery_default_count: Number(row.gallery_default_count ?? 4),
    brand_brief: row.brand_brief ? String(row.brand_brief) : null,
    niche: row.niche ? String(row.niche) : null,
    target_audience: row.target_audience ? String(row.target_audience) : null,
    brand_voice: row.brand_voice ? String(row.brand_voice) : null,
    value_props: row.value_props ? String(row.value_props) : null,
    default_language: row.default_language ? String(row.default_language) : null,
    currency: row.currency ? String(row.currency) : null,
    logo_url: row.logo_url ? String(row.logo_url) : null,
    brand_short_name: row.brand_short_name ? String(row.brand_short_name) : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

// ---------- Public API ----------

export async function listStores(): Promise<Store[]> {
  if (usePostgres()) {
    await ensurePgStoresSchema();
    const { sql } = await import("@vercel/postgres");
    const result = await sql.query(
      "SELECT * FROM stores ORDER BY is_active DESC, created_at ASC"
    );
    return result.rows.map(rowToStore);
  }
  return fileReadStores();
}

export async function getStore(id: string): Promise<Store | null> {
  if (usePostgres()) {
    await ensurePgStoresSchema();
    const { sql } = await import("@vercel/postgres");
    const result = await sql.query("SELECT * FROM stores WHERE id = $1", [id]);
    return result.rows[0] ? rowToStore(result.rows[0]) : null;
  }
  const stores = fileReadStores();
  return stores.find((s) => s.id === id) ?? null;
}

export async function getActiveStore(): Promise<Store | null> {
  if (usePostgres()) {
    await ensurePgStoresSchema();
    const { sql } = await import("@vercel/postgres");
    const result = await sql.query(
      "SELECT * FROM stores WHERE is_active = true LIMIT 1"
    );
    return result.rows[0] ? rowToStore(result.rows[0]) : null;
  }
  const stores = fileReadStores();
  return stores.find((s) => s.is_active) ?? null;
}

export async function createStore(input: CreateStoreInput): Promise<Store> {
  const now = new Date().toISOString();

  if (usePostgres()) {
    await ensurePgStoresSchema();
    const { sql } = await import("@vercel/postgres");
    const result = await sql.query(
      `INSERT INTO stores (name, domain, client_id, client_secret)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [input.name, input.domain, input.client_id, input.client_secret]
    );
    return rowToStore(result.rows[0]);
  }

  const stores = fileReadStores();
  if (stores.some((s) => s.domain === input.domain)) {
    throw new Error(`Store with domain ${input.domain} already exists`);
  }
  const store: Store = {
    id: crypto.randomUUID(),
    name: input.name,
    domain: input.domain,
    client_id: input.client_id,
    client_secret: input.client_secret,
    access_token: null,
    token_expires_at: null,
    is_active: false,
    character_reference_url: null,
    character_description: null,
    gallery_default_count: 4,
    brand_brief: null,
    niche: null,
    target_audience: null,
    brand_voice: null,
    value_props: null,
    default_language: null,
    currency: null,
    logo_url: null,
    brand_short_name: null,
    created_at: now,
    updated_at: now,
  };
  stores.push(store);
  fileWriteStores(stores);
  return store;
}

export async function updateStore(
  id: string,
  input: UpdateStoreInput
): Promise<Store> {
  if (usePostgres()) {
    await ensurePgStoresSchema();
    const { sql } = await import("@vercel/postgres");

    // Build dynamic SET clause
    const sets: string[] = ["updated_at = NOW()"];
    const values: unknown[] = [];
    let idx = 1;

    if (input.name !== undefined) {
      sets.push(`name = $${idx++}`);
      values.push(input.name);
    }
    if (input.domain !== undefined) {
      sets.push(`domain = $${idx++}`);
      values.push(input.domain);
    }
    if (input.client_id !== undefined) {
      // Clear cached token when credentials change
      sets.push(`client_id = $${idx++}`);
      values.push(input.client_id);
      sets.push("access_token = NULL, token_expires_at = NULL");
    }
    if (input.client_secret !== undefined) {
      sets.push(`client_secret = $${idx++}`);
      values.push(input.client_secret);
      sets.push("access_token = NULL, token_expires_at = NULL");
    }
    if (input.character_reference_url !== undefined) {
      sets.push(`character_reference_url = $${idx++}`);
      values.push(input.character_reference_url);
    }
    if (input.character_description !== undefined) {
      sets.push(`character_description = $${idx++}`);
      values.push(input.character_description);
    }
    if (input.gallery_default_count !== undefined) {
      sets.push(`gallery_default_count = $${idx++}`);
      values.push(input.gallery_default_count);
    }
    if (input.brand_brief !== undefined) {
      sets.push(`brand_brief = $${idx++}`);
      values.push(input.brand_brief);
    }
    if (input.niche !== undefined) {
      sets.push(`niche = $${idx++}`);
      values.push(input.niche);
    }
    if (input.target_audience !== undefined) {
      sets.push(`target_audience = $${idx++}`);
      values.push(input.target_audience);
    }
    if (input.brand_voice !== undefined) {
      sets.push(`brand_voice = $${idx++}`);
      values.push(input.brand_voice);
    }
    if (input.value_props !== undefined) {
      sets.push(`value_props = $${idx++}`);
      values.push(input.value_props);
    }
    if (input.default_language !== undefined) {
      sets.push(`default_language = $${idx++}`);
      values.push(input.default_language);
    }
    if (input.currency !== undefined) {
      sets.push(`currency = $${idx++}`);
      values.push(input.currency);
    }
    if (input.logo_url !== undefined) {
      sets.push(`logo_url = $${idx++}`);
      values.push(input.logo_url);
    }
    if (input.brand_short_name !== undefined) {
      sets.push(`brand_short_name = $${idx++}`);
      values.push(input.brand_short_name);
    }

    values.push(id);
    const result = await sql.query(
      `UPDATE stores SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
      values
    );
    if (!result.rows[0]) throw new Error("Store not found");
    return rowToStore(result.rows[0]);
  }

  const stores = fileReadStores();
  const idx = stores.findIndex((s) => s.id === id);
  if (idx === -1) throw new Error("Store not found");

  const store = stores[idx];
  if (input.name !== undefined) store.name = input.name;
  if (input.domain !== undefined) store.domain = input.domain;
  if (input.client_id !== undefined) {
    store.client_id = input.client_id;
    store.access_token = null;
    store.token_expires_at = null;
  }
  if (input.client_secret !== undefined) {
    store.client_secret = input.client_secret;
    store.access_token = null;
    store.token_expires_at = null;
  }
  if (input.character_reference_url !== undefined) store.character_reference_url = input.character_reference_url;
  if (input.character_description !== undefined) store.character_description = input.character_description;
  if (input.gallery_default_count !== undefined) store.gallery_default_count = input.gallery_default_count;
  if (input.brand_brief !== undefined) store.brand_brief = input.brand_brief;
  if (input.niche !== undefined) store.niche = input.niche;
  if (input.target_audience !== undefined) store.target_audience = input.target_audience;
  if (input.brand_voice !== undefined) store.brand_voice = input.brand_voice;
  if (input.value_props !== undefined) store.value_props = input.value_props;
  if (input.default_language !== undefined) store.default_language = input.default_language;
  if (input.currency !== undefined) store.currency = input.currency;
  if (input.logo_url !== undefined) store.logo_url = input.logo_url;
  if (input.brand_short_name !== undefined) store.brand_short_name = input.brand_short_name;
  store.updated_at = new Date().toISOString();
  stores[idx] = store;
  fileWriteStores(stores);
  return store;
}

export async function deleteStore(id: string): Promise<void> {
  if (usePostgres()) {
    await ensurePgStoresSchema();
    const { sql } = await import("@vercel/postgres");
    await sql.query("DELETE FROM stores WHERE id = $1", [id]);
    return;
  }

  const stores = fileReadStores();
  const filtered = stores.filter((s) => s.id !== id);
  fileWriteStores(filtered);
}

export async function setActiveStore(id: string): Promise<void> {
  if (usePostgres()) {
    await ensurePgStoresSchema();
    const { sql } = await import("@vercel/postgres");
    // Deactivate all, then activate the chosen one
    await sql.query("UPDATE stores SET is_active = false WHERE is_active = true");
    await sql.query(
      "UPDATE stores SET is_active = true, updated_at = NOW() WHERE id = $1",
      [id]
    );
    return;
  }

  const stores = fileReadStores();
  for (const s of stores) {
    s.is_active = s.id === id;
  }
  fileWriteStores(stores);
}

/**
 * One-shot migration: if the stores table is empty and SHOPIFY_* env vars
 * exist, seed a default active store so the app keeps working after deploy.
 */
export async function migrateEnvVarsToStores(): Promise<void> {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;

  if (!domain || !clientId || !clientSecret) return;

  const existing = await listStores();
  if (existing.length > 0) return;

  const store = await createStore({
    name: domain.replace(/\.myshopify\.com$/, ""),
    domain,
    client_id: clientId,
    client_secret: clientSecret,
  });
  await setActiveStore(store.id);
}

/** Cache a Shopify access token on the store row */
export async function cacheStoreToken(
  id: string,
  accessToken: string,
  expiresAt: Date
): Promise<void> {
  if (usePostgres()) {
    await ensurePgStoresSchema();
    const { sql } = await import("@vercel/postgres");
    await sql.query(
      `UPDATE stores SET access_token = $1, token_expires_at = $2, updated_at = NOW()
       WHERE id = $3`,
      [accessToken, expiresAt.toISOString(), id]
    );
    return;
  }

  const stores = fileReadStores();
  const store = stores.find((s) => s.id === id);
  if (store) {
    store.access_token = accessToken;
    store.token_expires_at = expiresAt.toISOString();
    store.updated_at = new Date().toISOString();
    fileWriteStores(stores);
  }
}
