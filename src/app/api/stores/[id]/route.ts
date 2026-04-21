import { NextRequest, NextResponse } from "next/server";
import { getStore, updateStore, deleteStore } from "@/lib/stores";

export const runtime = "nodejs";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let body: { name?: string; domain?: string; client_id?: string; client_secret?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const store = await updateStore(id, body);
    return NextResponse.json({ store });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status = message.includes("not found") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const store = await getStore(id);
    if (!store) {
      return NextResponse.json({ error: "Store not found" }, { status: 404 });
    }
    if (store.is_active) {
      return NextResponse.json(
        { error: "Cannot delete the active store. Activate another store first." },
        { status: 400 }
      );
    }
    await deleteStore(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
