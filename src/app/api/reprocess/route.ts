import { NextRequest, NextResponse } from "next/server";
import { generateImage } from "@/lib/image-generation";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  let body: { imageBase64?: string; mimeType?: string; prompt?: string; modelSlug?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.imageBase64 || !body.mimeType || !body.prompt) {
    return NextResponse.json(
      { error: "imageBase64, mimeType and prompt are required" },
      { status: 400 }
    );
  }

  const { imageBase64, mimeType, prompt } = body;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function send(data: Record<string, unknown>) {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
          );
        } catch {
          // Client disconnected — ignore, keep processing
        }
      }

      send({ index: 0, status: "processing" });

      try {
        const result = await generateImage({
          modelSlug: body.modelSlug,
          prompt,
          sourceImageBase64: imageBase64,
          sourceMimeType: mimeType,
        });
        send({
          index: 0,
          status: "done",
          imageBase64: result.imageBase64,
          mimeType: result.mimeType,
          prompt,
          modelUsed: result.modelUsed,
        });
      } catch (err) {
        send({
          index: 0,
          status: "error",
          error: err instanceof Error ? err.message : "Unknown error",
          prompt,
        });
      }

      send({ status: "complete" });
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
