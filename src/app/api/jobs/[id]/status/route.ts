import { NextRequest, NextResponse } from "next/server";
import { getJob } from "@/lib/jobs";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const job = await getJob(id);
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    // Return a lightweight status view (no base64 image data)
    const products = job.product_queue.map((p) => ({
      handle: p.handle,
      status: p.status,
      title: p.title,
      error: p.error,
      imageCount: p.images?.length ?? 0,
      aiGenerated: p.images?.some((img) => img.aiGenerated) ?? false,
    }));

    return NextResponse.json({
      id: job.id,
      status: job.status,
      total_products: job.total_products,
      completed_products: job.completed_products,
      failed_products: job.failed_products,
      products,
      created_at: job.created_at,
      updated_at: job.updated_at,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
