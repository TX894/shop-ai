import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DB_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DB_DIR, "shop-ai.db");

let _db: Database.Database | null = null;

function getDb(): Database.Database {
  if (_db) return _db;

  fs.mkdirSync(DB_DIR, { recursive: true });

  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");

  _db.exec(`
    CREATE TABLE IF NOT EXISTS library_items (
      id            TEXT PRIMARY KEY,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      preset_id     TEXT NOT NULL,
      collection    TEXT NOT NULL DEFAULT 'general',
      role          TEXT NOT NULL DEFAULT 'hero',
      prompt        TEXT,
      custom_prompt TEXT,
      original_path TEXT NOT NULL,
      result_path   TEXT NOT NULL,
      original_mime TEXT NOT NULL DEFAULT 'image/png',
      result_mime   TEXT NOT NULL DEFAULT 'image/png',
      notes         TEXT
    )
  `);

  // Migrations — add columns if missing (SQLite has no IF NOT EXISTS for ALTER)
  const migrations = [
    "ALTER TABLE library_items ADD COLUMN shopify_product_id TEXT",
    "ALTER TABLE library_items ADD COLUMN shopify_admin_url TEXT",
    "ALTER TABLE library_items ADD COLUMN source_store TEXT",
    "ALTER TABLE library_items ADD COLUMN source_product_url TEXT",
    "ALTER TABLE library_items ADD COLUMN imported_at TEXT",
  ];
  for (const sql of migrations) {
    try { _db.exec(sql); } catch { /* column already exists */ }
  }

  return _db;
}

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

export function insertItem(item: InsertLibraryItem): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO library_items (id, preset_id, collection, role, prompt, custom_prompt, original_path, result_path, original_mime, result_mime, notes, shopify_product_id, shopify_admin_url, source_store, source_product_url, imported_at)
    VALUES (@id, @preset_id, @collection, @role, @prompt, @custom_prompt, @original_path, @result_path, @original_mime, @result_mime, @notes, @shopify_product_id, @shopify_admin_url, @source_store, @source_product_url, @imported_at)
  `).run({
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

export function updateItemShopify(
  id: string,
  fields: { shopify_product_id: string; shopify_admin_url: string; imported_at: string }
): void {
  const db = getDb();
  db.prepare(
    "UPDATE library_items SET shopify_product_id = ?, shopify_admin_url = ?, imported_at = ? WHERE id = ?"
  ).run(fields.shopify_product_id, fields.shopify_admin_url, fields.imported_at, id);
}

export function listItems(limit = 100, offset = 0): LibraryRow[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM library_items ORDER BY created_at DESC LIMIT ? OFFSET ?")
    .all(limit, offset) as LibraryRow[];
}

export function getItem(id: string): LibraryRow | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM library_items WHERE id = ?").get(id) as LibraryRow | undefined;
}

export function deleteItem(id: string): boolean {
  const db = getDb();
  const result = db.prepare("DELETE FROM library_items WHERE id = ?").run(id);
  return result.changes > 0;
}

export function countItems(): number {
  const db = getDb();
  const row = db.prepare("SELECT COUNT(*) as count FROM library_items").get() as { count: number };
  return row.count;
}
