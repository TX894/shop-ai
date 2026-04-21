/**
 * Shopify OAuth client credentials grant.
 * Tokens last 24h; we cache in memory and refresh at 22h.
 */

import { getConfigValue, registerCacheInvalidator } from "./settings";

const TOKEN_LIFETIME_MS = 22 * 60 * 60 * 1000; // 22h (2h margin on 24h)

let cachedToken: string | null = null;
let tokenExpiresAt = 0;

// Invalidate cached token when settings change
registerCacheInvalidator(() => {
  cachedToken = null;
  tokenExpiresAt = 0;
});

function getConfig() {
  const domain = getConfigValue("SHOPIFY_STORE_DOMAIN");
  const clientId = getConfigValue("SHOPIFY_CLIENT_ID");
  const clientSecret = getConfigValue("SHOPIFY_CLIENT_SECRET");

  if (!domain || !clientId || !clientSecret) {
    throw new Error(
      "Missing Shopify config. Set via /settings or .env.local"
    );
  }

  return { domain, clientId, clientSecret };
}

export async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }

  const { domain, clientId, clientSecret } = getConfig();

  const res = await fetch(`https://${domain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    }),
  });

  if (!res.ok) {
    const status = res.status;
    if (status === 401 || status === 403) {
      throw new Error(
        "Shopify auth failed: verify SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET in .env.local"
      );
    }
    throw new Error(`Shopify auth failed: HTTP ${status}`);
  }

  const data = (await res.json()) as { access_token?: string; scope?: string };
  if (!data.access_token) {
    throw new Error("Shopify auth: no access_token in response");
  }

  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + TOKEN_LIFETIME_MS;

  return cachedToken;
}

export function getStoreDomain(): string {
  return getConfig().domain;
}
