import { NextRequest, NextResponse } from "next/server";
import { editImage } from "@/lib/gemini";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  let body: { imageBase64?: string; mimeType?: string; prompt?: string };
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
        const edited = await editImage({ imageBase64, mimeType, prompt });
        send({
          index: 0,
          status: "done",
          imageBase64: edited.imageBase64,
          mimeType: edited.mimeType,
          prompt,
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
