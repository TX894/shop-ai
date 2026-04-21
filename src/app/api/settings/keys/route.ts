import { NextRequest, NextResponse } from "next/server";
import { getMaskedKeys, updateKeys } from "@/lib/settings";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ keys: getMaskedKeys() });
}

export async function POST(req: NextRequest) {
  let body: Record<string, string>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  updateKeys(body);
  return NextResponse.json({ ok: true, keys: getMaskedKeys() });
}
