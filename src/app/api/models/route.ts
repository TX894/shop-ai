import { NextResponse } from "next/server";
import { getAllModels, getEditingModels } from "@/lib/image-generation";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const editingOnly = searchParams.get("editing") === "true";

  const models = editingOnly ? getEditingModels() : getAllModels();

  return NextResponse.json({
    models: models.map((m) => ({
      slug: m.slug,
      displayName: m.displayName,
      description: m.description,
      supportsEditing: m.supportsEditing,
      creditsPerImage: m.creditsPerImage,
    })),
  });
}
