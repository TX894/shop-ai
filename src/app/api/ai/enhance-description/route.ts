import { NextRequest, NextResponse } from "next/server";
import { enhanceDescription } from "@/lib/translation-service";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: { html?: string; title?: string; language?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.title) {
    return NextResponse.json({ error: "title required" }, { status: 400 });
  }
  try {
    const enhanced = await enhanceDescription(body.html ?? "", body.title, body.language ?? "en");
    return NextResponse.json({ enhanced });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Enhancement failed" },
      { status: 500 }
    );
  }
}
