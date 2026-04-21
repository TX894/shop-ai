import { NextRequest, NextResponse } from "next/server";
import { getMaskedKeys, updateKeys } from "@/lib/settings";
import { ensureMigrations } from "@/lib/migrate";

export const runtime = "nodejs";

export async function GET() {
  await ensureMigrations();
  const keys = await getMaskedKeys();
  return NextResponse.json({ keys });
}

export async function POST(req: NextRequest) {
  let body: Record<string, string>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    await updateKeys(body);
    const keys = await getMaskedKeys();
    return NextResponse.json({ ok: true, keys });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save settings";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
