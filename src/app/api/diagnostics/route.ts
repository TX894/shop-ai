/**
 * One-shot health check. Open /api/diagnostics in the browser and it tells
 * you, in plain language, exactly which dependency is broken:
 *   - Anthropic (text translation, title/description rewrite, SEO bundle)
 *   - kie.ai (image translation, AI restyle) + remaining credit balance
 *   - Postgres (settings + stores + jobs)
 *   - Vercel Blob (image storage)
 *   - Active Shopify store + auth token
 *
 * Built after a run reported "0 of 61 images translated" with no visible
 * error — every failure was swallowed by try/catch in the import pipeline.
 */

import { NextResponse } from "next/server";
import { getConfigValue } from "@/lib/settings";

export const runtime = "nodejs";
export const maxDuration = 60;

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

export async function GET() {
  const checks: Check[] = [];

  // ── 1. Anthropic key (all text AI) ────────────────────────────────
  try {
    const key = process.env.ANTHROPIC_KEY ?? "";
    if (!key) {
      checks.push({ name: "Anthropic API (text translation)", ok: false, detail: "ANTHROPIC_KEY env var is empty" });
    } else {
      const { complete } = await import("@/lib/anthropic-client");
      const reply = await complete("Reply with exactly: OK", "ping", { maxTokens: 16, temperature: 0 });
      checks.push({
        name: "Anthropic API (text translation)",
        ok: reply.toUpperCase().includes("OK"),
        detail: reply.toUpperCase().includes("OK")
          ? `Working — key ...${key.slice(-4)}`
          : `Unexpected reply: ${reply.slice(0, 80)}`,
      });
    }
  } catch (err) {
    checks.push({
      name: "Anthropic API (text translation)",
      ok: false,
      detail: `FAILED: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  // ── 2. kie.ai key + credit balance (image translation / restyle) ──
  try {
    const kieKey = await getConfigValue("KIE_AI_API_KEY");
    if (!kieKey) {
      checks.push({ name: "kie.ai API (image translation)", ok: false, detail: "KIE_AI_API_KEY is not set (settings + env both empty)" });
    } else {
      const res = await fetch("https://api.kie.ai/api/v1/chat/credit", {
        headers: { Authorization: `Bearer ${kieKey}` },
      });
      const body = await res.json().catch(() => ({}));
      // kie.ai returns { code: 200, data: <credits> } on success
      const credits = typeof body?.data === "number" ? body.data : body?.data?.credits;
      if (res.ok && body?.code === 200) {
        const lowBalance = typeof credits === "number" && credits < 50;
        checks.push({
          name: "kie.ai API (image translation)",
          ok: !lowBalance,
          detail: lowBalance
            ? `⚠️ LOW BALANCE: only ${credits} credits left. Image translation needs ~4-8 per image. Top up at kie.ai.`
            : `Working — ${credits ?? "?"} credits remaining (key ...${kieKey.slice(-4)})`,
        });
      } else {
        checks.push({
          name: "kie.ai API (image translation)",
          ok: false,
          detail: `FAILED: HTTP ${res.status} — ${body?.msg ?? JSON.stringify(body).slice(0, 120)}`,
        });
      }
    }
  } catch (err) {
    checks.push({
      name: "kie.ai API (image translation)",
      ok: false,
      detail: `FAILED: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  // ── 3. Postgres ───────────────────────────────────────────────────
  try {
    if (!process.env.POSTGRES_URL) {
      checks.push({ name: "Postgres database", ok: false, detail: "POSTGRES_URL not set — running on filesystem fallback" });
    } else {
      const { sql } = await import("@vercel/postgres");
      await sql.query("SELECT 1");
      checks.push({ name: "Postgres database", ok: true, detail: "Connected" });
    }
  } catch (err) {
    checks.push({
      name: "Postgres database",
      ok: false,
      detail: `FAILED: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  // ── 4. Vercel Blob ────────────────────────────────────────────────
  checks.push({
    name: "Vercel Blob (image storage)",
    ok: !!process.env.BLOB_READ_WRITE_TOKEN,
    detail: process.env.BLOB_READ_WRITE_TOKEN ? "Token present" : "BLOB_READ_WRITE_TOKEN not set",
  });

  // ── 5. Active Shopify store + token ───────────────────────────────
  try {
    const { getActiveStore } = await import("@/lib/stores");
    const store = await getActiveStore();
    if (!store) {
      checks.push({ name: "Active Shopify store", ok: false, detail: "No active store — add and activate one in Settings" });
    } else {
      const { getAccessToken } = await import("@/lib/shopify-auth");
      const token = await getAccessToken();
      checks.push({
        name: "Active Shopify store",
        ok: !!token,
        detail: `${store.name} (${store.domain}) — auth ${token ? "OK" : "FAILED"}`,
      });
    }
  } catch (err) {
    checks.push({
      name: "Active Shopify store",
      ok: false,
      detail: `FAILED: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  const allOk = checks.every((c) => c.ok);

  // Render a readable HTML page (so the user can just open it in a browser)
  const rows = checks
    .map(
      (c) => `<tr>
        <td style="padding:10px 14px;font-size:20px">${c.ok ? "✅" : "❌"}</td>
        <td style="padding:10px 14px;font-weight:600">${c.name}</td>
        <td style="padding:10px 14px;color:#555">${escapeHtml(c.detail)}</td>
      </tr>`
    )
    .join("");

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Shop AI — Diagnostics</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; background:#fafaf9; color:#1c1917; margin:0; padding:40px }
  .card { max-width:760px; margin:0 auto; background:#fff; border:1px solid #e7e5e4; border-radius:16px; overflow:hidden }
  h1 { font-size:20px; margin:0; padding:20px 24px; border-bottom:1px solid #e7e5e4 }
  .banner { padding:14px 24px; font-weight:600 }
  table { width:100%; border-collapse:collapse }
  tr:not(:last-child) td { border-bottom:1px solid #f5f5f4 }
  .foot { padding:16px 24px; font-size:13px; color:#78716c; border-top:1px solid #e7e5e4 }
</style></head>
<body><div class="card">
  <h1>Shop AI — System Diagnostics</h1>
  <div class="banner" style="background:${allOk ? "#dcfce7" : "#fee2e2"};color:${allOk ? "#166534" : "#991b1b"}">
    ${allOk ? "All systems operational" : "One or more dependencies are broken — see below"}
  </div>
  <table>${rows}</table>
  <div class="foot">Generated ${new Date().toISOString()}. Refresh to re-run.</div>
</div></body></html>`;

  return new NextResponse(html, {
    status: allOk ? 200 : 503,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c] ?? c));
}
