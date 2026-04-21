import { NextResponse } from "next/server";
import { listPresets } from "@/lib/prompt-engine";

export const runtime = "nodejs";

export async function GET() {
  const presets = await listPresets();
  return NextResponse.json({ presets });
}
