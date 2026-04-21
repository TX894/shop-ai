/**
 * Settings persistence — Vercel Postgres in production, filesystem locally.
 * Detection: if POSTGRES_URL is set, use Postgres; otherwise JSON file.
 *
 * Reading priority: DB/file value > process.env > undefined
 */

import fs from "fs";
import path from "path";

const SETTINGS_PATH = path.join(process.cwd(), "data", "settings.json");

interface AppSettings {
  KIE_AI_API_KEY?: string;
  ANTHROPIC_KEY?: string;
  SHOPIFY_CLIENT_ID?: string;
  SHOPIFY_CLIENT_SECRET?: string;
  SHOPIFY_STORE_DOMAIN?: string;
  APP_PASSWORD?: string;
}

const KEY_NAMES = [
  "KIE_AI_API_KEY",
  "ANTHROPIC_KEY",
  "SHOPIFY_CLIENT_ID",
  "SHOPIFY_CLIENT_SECRET",
  "SHOPIFY_STORE_DOMAIN",
  "APP_PASSWORD",
] as const;

type KeyName = (typeof KEY_NAMES)[number];

// ---------- Backend detection ----------

function usePostgres(): boolean {
  return !!process.env.POSTGRES_URL;
}

// ---------- Postgres backend ----------

const CREATE_SETTINGS_TABLE_PG = `
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`;

let _pgSettingsMigrated = false;

async function ensurePgSettingsSchema(): Promise<void> {
  if (_pgSettingsMigrated) return;
  const { sql } = await import("@vercel/postgres");
  await sql.query(CREATE_SETTINGS_TABLE_PG);
  _pgSettingsMigrated = true;
}

async function pgReadAll(): Promise<AppSettings> {
  await ensurePgSettingsSchema();
  const { sql } = await import("@vercel/postgres");
  const result = await sql.query("SELECT key, value FROM app_settings");
  const settings: AppSettings = {};
  for (const row of result.rows) {
    if (KEY_NAMES.includes(row.key as KeyName)) {
      (settings as Record<string, string>)[row.key] = row.value;
    }
  }
  return settings;
}

async function pgUpsert(updates: Partial<AppSettings>): Promise<void> {
  await ensurePgSettingsSchema();
  const { sql } = await import("@vercel/postgres");
  for (const key of KEY_NAMES) {
    const val = updates[key];
    if (val !== undefined && val !== "") {
      await sql.query(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
        [key, val]
      );
    }
  }
}

// ---------- Filesystem backend ----------

function fileReadAll(): AppSettings {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      const raw = fs.readFileSync(SETTINGS_PATH, "utf-8");
      return JSON.parse(raw) as AppSettings;
    }
  } catch {
    /* ignore */
  }
  return {};
}

function fileWrite(settings: AppSettings): void {
  const dir = path.dirname(SETTINGS_PATH);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
}

// ---------- Public API (all async) ----------

/** Read all settings from the active backend */
export async function readSettings(): Promise<AppSettings> {
  if (usePostgres()) {
    return pgReadAll();
  }
  return fileReadAll();
}

/** Get a config value: DB/file first, then process.env */
export async function getConfigValue(key: KeyName): Promise<string> {
  const settings = await readSettings();
  const storedVal = settings[key];
  if (storedVal) return storedVal;
  return process.env[key] ?? "";
}

/** Get all keys, masked for display */
export async function getMaskedKeys(): Promise<
  Record<KeyName, { set: boolean; masked: string }>
> {
  const result = {} as Record<KeyName, { set: boolean; masked: string }>;
  const settings = await readSettings();

  for (const key of KEY_NAMES) {
    const val = settings[key] || process.env[key] || "";
    if (val) {
      const last4 = val.slice(-4);
      const prefix = val.slice(0, Math.min(6, val.length - 4));
      result[key] = {
        set: true,
        masked: `${prefix}${"*".repeat(Math.max(0, val.length - 10))}${last4}`,
      };
    } else {
      result[key] = { set: false, masked: "" };
    }
  }
  return result;
}

/** Update keys in the active backend (only non-empty values are written) */
export async function updateKeys(
  updates: Partial<AppSettings>
): Promise<void> {
  if (usePostgres()) {
    await pgUpsert(updates);
  } else {
    const current = fileReadAll();
    for (const key of KEY_NAMES) {
      const val = updates[key];
      if (val !== undefined && val !== "") {
        current[key] = val;
      }
    }
    fileWrite(current);
  }
  invalidateAllCaches();
}

// --- Cache invalidation registry ---
type InvalidateFn = () => void;
const cacheInvalidators: InvalidateFn[] = [];

export function registerCacheInvalidator(fn: InvalidateFn): void {
  cacheInvalidators.push(fn);
}

export function invalidateAllCaches(): void {
  for (const fn of cacheInvalidators) {
    try {
      fn();
    } catch {
      /* ignore */
    }
  }
}
