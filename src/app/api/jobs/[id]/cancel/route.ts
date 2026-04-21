import { NextRequest, NextResponse } from "next/server";
import { cancelJob } from "@/lib/jobs";

export const runtime = "nodejs";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const job = await cancelJob(id);
    return NextResponse.json({
      status: job.status,
      completed: job.completed_products,
      failed: job.failed_products,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: err instanceof Error && err.message.includes("not found") ? 404 : 500 }
    );
  }
}
