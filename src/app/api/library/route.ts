import { NextRequest, NextResponse } from "next/server";
import { insertItem, listItems, countItems } from "@/lib/db";
import { saveImage, generateId } from "@/lib/storage";

export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);
  const offset = Number(url.searchParams.get("offset") ?? 0);

  const items = await listItems(limit, offset);
  const total = await countItems();

  return NextResponse.json({ items, total, limit, offset });
}

export async function POST(req: NextRequest) {
  let body: {
    presetId: string;
    collection?: string;
    role?: string;
    prompt?: string;
    customPrompt?: string;
    originalBase64: string;
    originalMime: string;
    resultBase64: string;
    resultMime: string;
    notes?: string;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.originalBase64 || !body.resultBase64 || !body.presetId) {
    return NextResponse.json(
      { error: "originalBase64, resultBase64, and presetId are required" },
      { status: 400 }
    );
  }

  const id = generateId();
  const originalPath = await saveImage(body.originalBase64, body.originalMime || "image/png", `${id}-original`);
  const resultPath = await saveImage(body.resultBase64, body.resultMime || "image/png", `${id}-result`);

  await insertItem({
    id,
    preset_id: body.presetId,
    collection: body.collection ?? "general",
    role: body.role ?? "hero",
    prompt: body.prompt,
    custom_prompt: body.customPrompt,
    original_path: originalPath,
    result_path: resultPath,
    original_mime: body.originalMime || "image/png",
    result_mime: body.resultMime || "image/png",
    notes: body.notes,
  });

  return NextResponse.json({ id }, { status: 201 });
}
