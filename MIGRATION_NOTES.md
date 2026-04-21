# Migration Notes — Multi-Store Settings (Sprint 7)

## What changed

### New files
- `src/lib/stores.ts` — Multi-store CRUD with dual-backend (Postgres/filesystem)
- `src/lib/migrate.ts` — One-shot env var to DB migration on first request
- `src/app/api/stores/route.ts` — GET (list) / POST (create) stores
- `src/app/api/stores/[id]/route.ts` — PATCH (update) / DELETE stores
- `src/app/api/stores/[id]/activate/route.ts` — POST set active store
- `src/app/api/stores/test/route.ts` — POST test credentials without saving

### Modified files
- `src/lib/settings.ts` — Removed SHOPIFY_* and APP_PASSWORD keys; now only manages KIE_AI_API_KEY. Added `migrateEnvVarsToSettings()`.
- `src/lib/shopify-auth.ts` — Rewritten to read credentials from `stores` table instead of env vars. Tokens cached in DB. Added `testShopifyCredentials()`.
- `src/lib/shopify-admin.ts` — Updated `getStoreDomain()` calls (now async, already was).
- `src/lib/anthropic-client.ts` — Reads ANTHROPIC_KEY directly from `process.env` (no longer goes through settings.ts).
- `src/app/api/settings/keys/route.ts` — Calls `ensureMigrations()` on GET.
- `src/app/settings/page.tsx` — Redesigned with two sections: API Keys (KIE) and Stores (list/add/edit/delete/activate).

### New DB table
`stores` — auto-created on first request via `CREATE TABLE IF NOT EXISTS`. No manual migration needed.

## Env vars that can be REMOVED from Vercel (after verifying the deploy works)

These have been migrated to the DB and are no longer read by the app:
- `SHOPIFY_STORE_DOMAIN`
- `SHOPIFY_CLIENT_ID`
- `SHOPIFY_CLIENT_SECRET`
- `KIE_AI_API_KEY`

**Note:** On first request after deploy, the auto-migration will copy these values from env vars into the DB. Only remove them AFTER confirming the migration ran (check /settings — your store should appear in the list).

## Env vars that MUST stay in Vercel

- `POSTGRES_URL` (and the 5 related: `POSTGRES_URL_NON_POOLING`, `POSTGRES_USER`, `POSTGRES_HOST`, `POSTGRES_PASSWORD`, `POSTGRES_DATABASE`)
- `ANTHROPIC_KEY`
- `APP_PASSWORD`
- `BLOB_READ_WRITE_TOKEN`

## Test steps (post-deploy)

1. Open `/settings` — verify the KIE key shows as "Set" (migrated from env var)
2. Verify your existing Shopify store appears in the Stores list with "Active" badge
3. Click the store's "..." menu > Edit — confirm name and domain are correct
4. Add a second store via "+ Add Store" — fill credentials, click "Test Connection", then save
5. Switch active store using the radio button
6. Go to `/scan` — run an import against the active store to confirm Shopify auth works end-to-end
7. Delete the test store (must deactivate first)
8. Check that the original store still works after delete
