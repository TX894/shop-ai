/**
 * Lightweight kie.ai credit-balance probe.
 * The import modal calls this on open so the user is warned BEFORE
 * starting an import that would silently fail on 0 credits.
 */

import { NextResponse } from "next/server";
import { getConfigValue } from "@/lib/settings";

export const runtime = "nodejs";

export async function GET() {
  try {
    const key = await getConfigValue("KIE_AI_API_KEY");
    if (!key) {
      return NextResponse.json({ ok: false, credits: null, error: "KIE_AI_API_KEY not set" });
    }
    const res = await fetch("https://api.kie.ai/api/v1/chat/credit", {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body?.code !== 200) {
      return NextResponse.json({
        ok: false,
        credits: null,
        error: body?.msg ?? `HTTP ${res.status}`,
      });
    }
    const credits = typeof body.data === "number" ? body.data : body?.data?.credits ?? null;
    return NextResponse.json({ ok: true, credits });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      credits: null,
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }
}
