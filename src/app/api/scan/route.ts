import { NextRequest, NextResponse } from "next/server";
import { scanStore } from "@/lib/shopify-scraper";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  let body: { url?: string };
  try {
    body = (await req.json()) as { url?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.url?.trim()) {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }

  try {
    const { products, collectionHandle } = await scanStore(body.url);
    return NextResponse.json({ products, totalCount: products.length, collectionHandle });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
