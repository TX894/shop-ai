import { NextResponse } from "next/server";
import { queryShop } from "@/lib/shopify-admin";

export const runtime = "nodejs";

export async function GET() {
  try {
    const shop = await queryShop();
    return NextResponse.json({
      ok: true,
      shopName: shop.name,
      domain: shop.myshopifyDomain,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 200 } // Always 200 so frontend can read the JSON
    );
  }
}
