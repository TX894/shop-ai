import { NextRequest, NextResponse } from "next/server";
import { getItem, deleteItem } from "@/lib/db";
import { deleteImage } from "@/lib/storage";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const item = getItem(id);
  if (!item) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(item);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const item = getItem(id);
  if (!item) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  deleteImage(item.original_path);
  deleteImage(item.result_path);
  deleteItem(id);

  return NextResponse.json({ deleted: true });
}
