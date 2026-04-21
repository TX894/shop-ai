import { NextResponse } from "next/server";
import { getAllShotPresets } from "@/lib/image-generation/shot-presets";

export const runtime = "nodejs";

export async function GET() {
  const presets = getAllShotPresets();
  return NextResponse.json({ presets });
}
