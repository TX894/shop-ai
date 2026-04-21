/**
 * Shopify OAuth client credentials grant — multi-store aware.
 * Reads credentials from the stores table. Tokens (24h) are cached in DB.
 */

import { getActiveStore, getStore, cacheStoreToken, type Store } from "./stores";

const TOKEN_LIFETIME_MS = 22 * 60 * 60 * 1000; // 22h (2h margin on 24h)

async function resolveStore(storeId?: string): Promise<Store> {
  const store = storeId ? await getStore(storeId) : await getActiveStore();
  if (!store) {
    throw new Error(
      storeId
        ? `Store ${storeId} not found`
        : "No active store. Add one via /settings."
    );
  }
  return store;
}

export async function getAccessToken(storeId?: string): Promise<string> {
  const store = await resolveStore(storeId);

  // Check cached token (with 60s safety margin)
  if (
    store.access_token &&
    store.token_expires_at &&
    new Date(store.token_expires_at).getTime() > Date.now() + 60_000
  ) {
    return store.access_token;
  }

  // Request new token
  const res = await fetch(`https://${store.domain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: store.client_id,
      client_secret: store.client_secret,
      grant_type: "client_credentials",
    }),
  });

  if (!res.ok) {
    const status = res.status;
    if (status === 401 || status === 403) {
      throw new Error(
        `Shopify auth failed for ${store.name}: invalid credentials`
      );
    }
    throw new Error(`Shopify auth failed for ${store.name}: HTTP ${status}`);
  }

  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new Error("Shopify auth: no access_token in response");
  }

  // Cache token in DB
  const expiresAt = new Date(Date.now() + TOKEN_LIFETIME_MS);
  await cacheStoreToken(store.id, data.access_token, expiresAt);

  return data.access_token;
}

export async function getStoreDomain(storeId?: string): Promise<string> {
  const store = await resolveStore(storeId);
  return store.domain;
}

/** Test credentials without saving — used by the "Test Connection" button */
export async function testShopifyCredentials(
  domain: string,
  clientId: string,
  clientSecret: string
): Promise<{ ok: boolean; shopName?: string; error?: string }> {
  try {
    const tokenRes = await fetch(
      `https://${domain}/admin/oauth/access_token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: "client_credentials",
        }),
      }
    );

    if (!tokenRes.ok) {
      return { ok: false, error: `HTTP ${tokenRes.status}` };
    }

    const tokenData = (await tokenRes.json()) as { access_token?: string };
    if (!tokenData.access_token) {
      return { ok: false, error: "No access token returned" };
    }

    // Query shop name to confirm it works
    const shopRes = await fetch(
      `https://${domain}/admin/api/2025-01/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": tokenData.access_token,
        },
        body: JSON.stringify({
          query: "query { shop { name myshopifyDomain } }",
        }),
      }
    );

    if (!shopRes.ok) {
      return { ok: false, error: `GraphQL HTTP ${shopRes.status}` };
    }

    const shopData = (await shopRes.json()) as {
      data?: { shop?: { name: string } };
    };
    return {
      ok: true,
      shopName: shopData.data?.shop?.name ?? domain,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
