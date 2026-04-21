import { NextRequest, NextResponse } from "next/server";
import { pushProduct, type ProductDetails } from "@/lib/shopify-admin";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  let body: {
    libraryItemIds?: string[];
    productDetails?: ProductDetails;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (
    !Array.isArray(body.libraryItemIds) ||
    body.libraryItemIds.length === 0 ||
    !body.productDetails?.title
  ) {
    return NextResponse.json(
      { error: "libraryItemIds[] and productDetails.title are required" },
      { status: 400 }
    );
  }

  // SSE stream for progress
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(data: Record<string, unknown>) {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
          );
        } catch {
          // Client disconnected
        }
      }

      try {
        const result = await pushProduct(
          body.libraryItemIds!,
          body.productDetails!,
          (step) => send({ status: "progress", step })
        );
        send({ status: "done", result });
      } catch (err) {
        send({
          status: "error",
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
