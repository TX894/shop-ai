import { NextRequest, NextResponse } from "next/server";
import type { ShopifyProduct } from "@/types/shopify";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const store = req.nextUrl.searchParams.get("store");
  const handle = req.nextUrl.searchParams.get("handle");

  if (!store || !handle) {
    return NextResponse.json(
      { error: "store and handle are required" },
      { status: 400 }
    );
  }

  const url = `https://${store}/products/${handle}.json`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      cache: "no-store",
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Fetch failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 }
    );
  }

  if (!res.ok) {
    return NextResponse.json(
      { error: `HTTP ${res.status} from ${store}` },
      { status: res.status }
    );
  }

  let data: { product?: ShopifyProduct };
  try {
    data = (await res.json()) as { product?: ShopifyProduct };
  } catch {
    return NextResponse.json(
      { error: "Resposta JSON inválida da loja" },
      { status: 502 }
    );
  }

  if (!data.product) {
    return NextResponse.json(
      { error: `Produto "${handle}" não encontrado em ${store}` },
      { status: 404 }
    );
  }

  // Ensure images array exists
  if (!Array.isArray(data.product.images)) {
    data.product.images = [];
  }

  return NextResponse.json({ product: data.product });
}
