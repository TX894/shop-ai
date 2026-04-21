import { NextRequest, NextResponse } from "next/server";
import { translateText } from "@/lib/translation-service";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: { text?: string; targetLang?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.text || !body.targetLang) {
    return NextResponse.json({ error: "text and targetLang required" }, { status: 400 });
  }
  try {
    const translated = await translateText(body.text, body.targetLang);
    return NextResponse.json({ translated });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Translation failed" },
      { status: 500 }
    );
  }
}
