import { NextRequest, NextResponse } from "next/server";
import { testShopifyCredentials } from "@/lib/shopify-auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: { domain?: string; client_id?: string; client_secret?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.domain?.trim() || !body.client_id?.trim() || !body.client_secret?.trim()) {
    return NextResponse.json(
      { error: "domain, client_id, and client_secret are required" },
      { status: 400 }
    );
  }

  const result = await testShopifyCredentials(
    body.domain.trim(),
    body.client_id.trim(),
    body.client_secret.trim()
  );

  return NextResponse.json(result);
}
