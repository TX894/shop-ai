import { NextRequest, NextResponse } from "next/server";
import { getStore, setActiveStore } from "@/lib/stores";

export const runtime = "nodejs";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const store = await getStore(id);
    if (!store) {
      return NextResponse.json({ error: "Store not found" }, { status: 404 });
    }
    await setActiveStore(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
