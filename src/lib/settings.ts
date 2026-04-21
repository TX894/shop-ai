import fs from "fs";
import path from "path";

const SETTINGS_PATH = path.join(process.cwd(), "data", "settings.json");

interface AppSettings {
  KIE_AI_API_KEY?: string;
  ANTHROPIC_KEY?: string;
  SHOPIFY_CLIENT_ID?: string;
  SHOPIFY_CLIENT_SECRET?: string;
  SHOPIFY_STORE_DOMAIN?: string;
}

const KEY_NAMES = [
  "KIE_AI_API_KEY",
  "ANTHROPIC_KEY",
  "SHOPIFY_CLIENT_ID",
  "SHOPIFY_CLIENT_SECRET",
  "SHOPIFY_STORE_DOMAIN",
] as const;

type KeyName = (typeof KEY_NAMES)[number];

function readSettings(): AppSettings {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      const raw = fs.readFileSync(SETTINGS_PATH, "utf-8");
      return JSON.parse(raw) as AppSettings;
    }
  } catch { /* ignore */ }
  return {};
}

function writeSettings(settings: AppSettings): void {
  const dir = path.dirname(SETTINGS_PATH);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
}

/** Get a config value: settings.json first, then process.env */
export function getConfigValue(key: KeyName): string {
  const settings = readSettings();
  const fileVal = settings[key];
  if (fileVal) return fileVal;
  return process.env[key] ?? "";
}

/** Get all keys, masked for display */
export function getMaskedKeys(): Record<KeyName, { set: boolean; masked: string }> {
  const result = {} as Record<KeyName, { set: boolean; masked: string }>;
  for (const key of KEY_NAMES) {
    const val = getConfigValue(key);
    if (val) {
      const last4 = val.slice(-4);
      const prefix = val.slice(0, Math.min(6, val.length - 4));
      result[key] = { set: true, masked: `${prefix}${"•".repeat(Math.max(0, val.length - 10))}${last4}` };
    } else {
      result[key] = { set: false, masked: "" };
    }
  }
  return result;
}

/** Update keys in settings.json (only non-empty values are written) */
export function updateKeys(updates: Partial<AppSettings>): void {
  const current = readSettings();
  for (const key of KEY_NAMES) {
    const val = updates[key];
    if (val !== undefined && val !== "") {
      current[key] = val;
    }
  }
  writeSettings(current);
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
    try { fn(); } catch { /* ignore */ }
  }
}
