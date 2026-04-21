/**
 * One-shot env var → DB migration. Runs once per cold start.
 * Safe to call multiple times — each migration checks if work is needed.
 */

import { migrateEnvVarsToSettings } from "./settings";
import { migrateEnvVarsToStores } from "./stores";

let _migrated = false;

export async function ensureMigrations(): Promise<void> {
  if (_migrated) return;
  _migrated = true;

  try {
    await Promise.all([
      migrateEnvVarsToSettings(),
      migrateEnvVarsToStores(),
    ]);
  } catch (err) {
    // Don't block the app if migration fails — log and continue
    console.error("[migrate] env var migration error:", err);
    _migrated = false; // Retry next request
  }
}
