import { NextRequest, NextResponse } from "next/server";
import { resumeJob } from "@/lib/jobs";

export const runtime = "nodejs";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const job = await resumeJob(id);
    return NextResponse.json({
      status: job.status,
      total: job.total_products,
      completed: job.completed_products,
      failed: job.failed_products,
      pending: job.product_queue.filter((p) => p.status === "pending").length,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: err instanceof Error && err.message.includes("not found") ? 404 : 500 }
    );
  }
}
