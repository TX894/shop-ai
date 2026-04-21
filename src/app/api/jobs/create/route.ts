import { NextRequest, NextResponse } from "next/server";
import { createJob } from "@/lib/jobs";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: {
    selectedHandles?: string[];
    sourceStore?: string;
    options?: Record<string, unknown>;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (
    !Array.isArray(body.selectedHandles) ||
    body.selectedHandles.length === 0 ||
    !body.sourceStore
  ) {
    return NextResponse.json(
      { error: "selectedHandles[] and sourceStore are required" },
      { status: 400 }
    );
  }

  try {
    const job = await createJob({
      products: body.selectedHandles.map((handle) => ({
        handle,
        sourceStore: body.sourceStore!,
      })),
      options: JSON.stringify(body.options ?? body),
    });

    return NextResponse.json({ jobId: job.id }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
