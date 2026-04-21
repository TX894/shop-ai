/**
 * Database abstraction — Vercel Postgres in production, SQLite locally.
 * Detection: if POSTGRES_URL is set, use Postgres; otherwise SQLite.
 */

// ---------- Types (shared) ----------

export interface LibraryRow {
  id: string;
  created_at: string;
  preset_id: string;
  collection: string;
  role: string;
  prompt: string | null;
  custom_prompt: string | null;
  original_path: string;
  result_path: string;
  original_mime: string;
  result_mime: string;
  notes: string | null;
  shopify_product_id: string | null;
  shopify_admin_url: string | null;
  source_store: string | null;
  source_product_url: string | null;
  imported_at: string | null;
}

export interface InsertLibraryItem {
  id: string;
  preset_id: string;
  collection: string;
  role: string;
  prompt?: string;
  custom_prompt?: string;
  original_path: string;
  result_path: string;
  original_mime: string;
  result_mime: string;
  notes?: string;
  shopify_product_id?: string;
  shopify_admin_url?: string;
  source_store?: string;
  source_product_url?: string;
  imported_at?: string;
}

// ---------- Backend detection ----------

function usePostgres(): boolean {
  return !!process.env.POSTGRES_URL;
}

// ---------- Schema (standard SQL, compatible with both) ----------

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS library_items (
    id              TEXT PRIMARY KEY,
    created_at      TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    preset_id       TEXT NOT NULL,
    collection      TEXT NOT NULL DEFAULT 'general',
    role            TEXT NOT NULL DEFAULT 'hero',
    prompt          TEXT,
    custom_prompt   TEXT,
    original_path   TEXT NOT NULL,
    result_path     TEXT NOT NULL,
    original_mime   TEXT NOT NULL DEFAULT 'image/png',
    result_mime     TEXT NOT NULL DEFAULT 'image/png',
    notes           TEXT,
    shopify_product_id TEXT,
    shopify_admin_url  TEXT,
    source_store       TEXT,
    source_product_url TEXT,
    imported_at        TEXT
  )
`;

// Postgres version uses slightly different default syntax
const CREATE_TABLE_PG = `
  CREATE TABLE IF NOT EXISTS library_items (
    id              TEXT PRIMARY KEY,
    created_at      TEXT NOT NULL DEFAULT (NOW()::TEXT),
    preset_id       TEXT NOT NULL,
    collection      TEXT NOT NULL DEFAULT 'general',
    role            TEXT NOT NULL DEFAULT 'hero',
    prompt          TEXT,
    custom_prompt   TEXT,
    original_path   TEXT NOT NULL,
    result_path     TEXT NOT NULL,
    original_mime   TEXT NOT NULL DEFAULT 'image/png',
    result_mime     TEXT NOT NULL DEFAULT 'image/png',
    notes           TEXT,
    shopify_product_id TEXT,
    shopify_admin_url  TEXT,
    source_store       TEXT,
    source_product_url TEXT,
    imported_at        TEXT
  )
`;

// ---------- SQLite backend ----------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _sqliteDb: any = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getSqliteDb(): any {
  if (_sqliteDb) return _sqliteDb;

  // Dynamic require to avoid loading better-sqlite3 on Vercel
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require("better-sqlite3");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("path");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("fs");

  const DB_DIR = path.join(process.cwd(), "data");
  const DB_PATH = path.join(DB_DIR, "shop-ai.db");

  fs.mkdirSync(DB_DIR, { recursive: true });
  _sqliteDb = new Database(DB_PATH);
  _sqliteDb.pragma("journal_mode = WAL");
  _sqliteDb.pragma("foreign_keys = ON");
  _sqliteDb.exec(CREATE_TABLE_SQL);

  return _sqliteDb;
}

// ---------- Postgres backend ----------

let _pgMigrated = false;

async function ensurePgSchema(): Promise<void> {
  if (_pgMigrated) return;
  const { sql } = await import("@vercel/postgres");
  await sql.query(CREATE_TABLE_PG);
  _pgMigrated = true;
}

// ---------- Public API (all async) ----------

export async function insertItem(item: InsertLibraryItem): Promise<void> {
  if (usePostgres()) {
    await ensurePgSchema();
    const { sql } = await import("@vercel/postgres");
    await sql.query(
      `INSERT INTO library_items (id, preset_id, collection, role, prompt, custom_prompt, original_path, result_path, original_mime, result_mime, notes, shopify_product_id, shopify_admin_url, source_store, source_product_url, imported_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        item.id,
        item.preset_id,
        item.collection,
        item.role,
        item.prompt ?? null,
        item.custom_prompt ?? null,
        item.original_path,
        item.result_path,
        item.original_mime,
        item.result_mime,
        item.notes ?? null,
        item.shopify_product_id ?? null,
        item.shopify_admin_url ?? null,
        item.source_store ?? null,
        item.source_product_url ?? null,
        item.imported_at ?? null,
      ]
    );
    return;
  }

  const db = getSqliteDb();
  db.prepare(
    `INSERT INTO library_items (id, preset_id, collection, role, prompt, custom_prompt, original_path, result_path, original_mime, result_mime, notes, shopify_product_id, shopify_admin_url, source_store, source_product_url, imported_at)
     VALUES (@id, @preset_id, @collection, @role, @prompt, @custom_prompt, @original_path, @result_path, @original_mime, @result_mime, @notes, @shopify_product_id, @shopify_admin_url, @source_store, @source_product_url, @imported_at)`
  ).run({
    id: item.id,
    preset_id: item.preset_id,
    collection: item.collection,
    role: item.role,
    prompt: item.prompt ?? null,
    custom_prompt: item.custom_prompt ?? null,
    original_path: item.original_path,
    result_path: item.result_path,
    original_mime: item.original_mime,
    result_mime: item.result_mime,
    notes: item.notes ?? null,
    shopify_product_id: item.shopify_product_id ?? null,
    shopify_admin_url: item.shopify_admin_url ?? null,
    source_store: item.source_store ?? null,
    source_product_url: item.source_product_url ?? null,
    imported_at: item.imported_at ?? null,
  });
}

export async function updateItemShopify(
  id: string,
  fields: { shopify_product_id: string; shopify_admin_url: string; imported_at: string }
): Promise<void> {
  if (usePostgres()) {
    await ensurePgSchema();
    const { sql } = await import("@vercel/postgres");
    await sql.query(
      "UPDATE library_items SET shopify_product_id = $1, shopify_admin_url = $2, imported_at = $3 WHERE id = $4",
      [fields.shopify_product_id, fields.shopify_admin_url, fields.imported_at, id]
    );
    return;
  }

  const db = getSqliteDb();
  db.prepare(
    "UPDATE library_items SET shopify_product_id = ?, shopify_admin_url = ?, imported_at = ? WHERE id = ?"
  ).run(fields.shopify_product_id, fields.shopify_admin_url, fields.imported_at, id);
}

export async function listItems(limit = 100, offset = 0): Promise<LibraryRow[]> {
  if (usePostgres()) {
    await ensurePgSchema();
    const { sql } = await import("@vercel/postgres");
    const result = await sql.query(
      "SELECT * FROM library_items ORDER BY created_at DESC LIMIT $1 OFFSET $2",
      [limit, offset]
    );
    return result.rows as LibraryRow[];
  }

  const db = getSqliteDb();
  return db
    .prepare("SELECT * FROM library_items ORDER BY created_at DESC LIMIT ? OFFSET ?")
    .all(limit, offset) as LibraryRow[];
}

export async function getItem(id: string): Promise<LibraryRow | undefined> {
  if (usePostgres()) {
    await ensurePgSchema();
    const { sql } = await import("@vercel/postgres");
    const result = await sql.query("SELECT * FROM library_items WHERE id = $1", [id]);
    return (result.rows[0] as LibraryRow) ?? undefined;
  }

  const db = getSqliteDb();
  return db.prepare("SELECT * FROM library_items WHERE id = ?").get(id) as LibraryRow | undefined;
}

export async function deleteItem(id: string): Promise<boolean> {
  if (usePostgres()) {
    await ensurePgSchema();
    const { sql } = await import("@vercel/postgres");
    const result = await sql.query("DELETE FROM library_items WHERE id = $1", [id]);
    return (result.rowCount ?? 0) > 0;
  }

  const db = getSqliteDb();
  const result = db.prepare("DELETE FROM library_items WHERE id = ?").run(id);
  return result.changes > 0;
}

export async function countItems(): Promise<number> {
  if (usePostgres()) {
    await ensurePgSchema();
    const { sql } = await import("@vercel/postgres");
    const result = await sql.query("SELECT COUNT(*) as count FROM library_items");
    return parseInt(result.rows[0]?.count ?? "0", 10);
  }

  const db = getSqliteDb();
  const row = db.prepare("SELECT COUNT(*) as count FROM library_items").get() as { count: number };
  return row.count;
}
