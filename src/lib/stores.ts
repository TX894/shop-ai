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

async function ensurePgStoresSchema(): Promise<void> {
  if (_pgStoresMigrated) return;
  const { sql } = await import("@vercel/postgres");
  await sql.query(CREATE_STORES_TABLE_PG);
  await sql.query(CREATE_ACTIVE_INDEX_PG);
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
