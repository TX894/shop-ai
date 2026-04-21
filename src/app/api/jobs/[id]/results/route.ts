import { NextRequest, NextResponse } from "next/server";
import { getJob } from "@/lib/jobs";

export const runtime = "nodejs";

/** Returns the full job results including image data, for the review page */
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
    if (job.status !== "done" && job.status !== "failed") {
      return NextResponse.json(
        { error: "Job not finished yet", status: job.status },
        { status: 400 }
      );
    }

    // Return completed products with their full data
    const products = job.results
      .filter((p) => p.status === "done")
      .map((p) => ({
        handle: p.handle,
        title: p.title ?? p.handle,
        description: p.description ?? "",
        vendor: p.vendor ?? "",
        productType: p.productType ?? "",
        price: p.price ?? "29.95",
        images: (p.images ?? []).map((img) => ({
          role: img.role,
          originalUrl: img.originalUrl,
          resultBase64: img.resultBase64,
          resultMime: img.resultMime,
          resultUrl: img.resultUrl,
          aiGenerated: img.aiGenerated,
          error: img.error,
        })),
      }));

    return NextResponse.json({
      id: job.id,
      status: job.status,
      options: job.options,
      products,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
