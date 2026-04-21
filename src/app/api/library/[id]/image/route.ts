import { NextRequest, NextResponse } from "next/server";
import { getItem } from "@/lib/db";
import { readImage } from "@/lib/storage";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const type = req.nextUrl.searchParams.get("type") ?? "result";
  const item = await getItem(id);

  if (!item) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const pathOrUrl = type === "original" ? item.original_path : item.result_path;

  // Blob URL — redirect directly
  if (pathOrUrl.startsWith("https://")) {
    return NextResponse.redirect(pathOrUrl);
  }

  // Local file — serve bytes
  const file = await readImage(pathOrUrl);
  if (!file) {
    return NextResponse.json({ error: "Image file missing" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(file.buffer), {
    headers: {
      "Content-Type": file.mime,
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
