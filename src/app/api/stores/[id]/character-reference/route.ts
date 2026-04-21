import { NextRequest, NextResponse } from "next/server";
import { getStore, updateStore } from "@/lib/stores";
import { saveImage, deleteImage } from "@/lib/storage";

export const runtime = "nodejs";

const MAX_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/jpg"]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const store = await getStore(id);
  if (!store) {
    return NextResponse.json({ error: "Store not found" }, { status: 404 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const description = formData.get("description") as string | null;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: "Only JPG and PNG files are accepted" },
        { status: 400 }
      );
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { error: "File must be under 5MB" },
        { status: 400 }
      );
    }

    // Delete old reference if exists
    if (store.character_reference_url) {
      try { await deleteImage(store.character_reference_url); } catch { /* ignore */ }
    }

    // Save new reference
    const buffer = Buffer.from(await file.arrayBuffer());
    const base64 = buffer.toString("base64");
    const url = await saveImage(base64, file.type, `character-ref-${id}`);

    await updateStore(id, {
      character_reference_url: url,
      character_description: description || null,
    });

    return NextResponse.json({ url });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload failed" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const store = await getStore(id);
  if (!store) {
    return NextResponse.json({ error: "Store not found" }, { status: 404 });
  }

  if (store.character_reference_url) {
    try { await deleteImage(store.character_reference_url); } catch { /* ignore */ }
  }

  await updateStore(id, {
    character_reference_url: null,
    character_description: null,
  });

  return NextResponse.json({ ok: true });
}
