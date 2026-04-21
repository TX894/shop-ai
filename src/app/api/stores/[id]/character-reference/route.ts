import { NextRequest, NextResponse } from "next/server";
import { getStore, updateStore } from "@/lib/stores";

export const runtime = "nodejs";

const MAX_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/jpg", "image/webp"]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const store = await getStore(id);
  if (!store) {
    return NextResponse.json({ error: "Store not found" }, { status: 404 });
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "Vercel Blob not configured — set BLOB_READ_WRITE_TOKEN in environment variables" },
      { status: 500 }
    );
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
        { error: "Only JPG, PNG and WebP files are accepted" },
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
    if (store.character_reference_url?.startsWith("https://")) {
      try {
        const { del } = await import("@vercel/blob");
        await del(store.character_reference_url);
      } catch { /* ignore — old blob may already be gone */ }
    }

    // Upload directly to Vercel Blob (never filesystem)
    // Store MUST be public — private stores break direct URL access
    const { put } = await import("@vercel/blob");
    let blob;
    try {
      blob = await put(
        `character-refs/${id}/${Date.now()}-${file.name}`,
        file,
        { access: "public", contentType: file.type }
      );
    } catch (blobErr) {
      if (blobErr instanceof Error && blobErr.message.includes("public access on a private store")) {
        return NextResponse.json(
          { error: "Blob store is private but must be public. Create a new PUBLIC Blob Store in Vercel Dashboard > Storage." },
          { status: 500 }
        );
      }
      throw blobErr;
    }

    await updateStore(id, {
      character_reference_url: blob.url,
      character_description: description || null,
    });

    return NextResponse.json({ url: blob.url });
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

  if (store.character_reference_url?.startsWith("https://")) {
    try {
      const { del } = await import("@vercel/blob");
      await del(store.character_reference_url);
    } catch { /* ignore */ }
  }

  await updateStore(id, {
    character_reference_url: null,
    character_description: null,
  });

  return NextResponse.json({ ok: true });
}
