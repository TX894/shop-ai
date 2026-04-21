/**
 * Resilient fetch utilities — timeout + retry with exponential backoff.
 */

const DEFAULT_TIMEOUT_MS = 45_000;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

/** Fetch with an AbortController timeout */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch with retry + exponential backoff. Retries on 429/5xx and timeouts. */
export async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  maxRetries = 3,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetchWithTimeout(url, options, timeoutMs);
      if (res.ok) return res;

      if (!RETRYABLE_STATUS.has(res.status) || attempt === maxRetries) {
        return res; // Return the failed response — caller decides what to do
      }

      const delay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
      console.log(
        `[fetch-retry] ${attempt}/${maxRetries} for ${url} — HTTP ${res.status}, retrying in ${delay}ms`
      );
      await new Promise((r) => setTimeout(r, delay));
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        console.log(
          `[fetch-retry] Timeout attempt ${attempt}/${maxRetries} for ${url}`
        );
        if (attempt === maxRetries) {
          throw new Error(`Fetch timed out after ${maxRetries} attempts: ${url}`);
        }
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }

  // Should never reach here, but just in case
  throw new Error(`Fetch failed after ${maxRetries} retries: ${url}`);
}
