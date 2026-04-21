import { NextRequest, NextResponse } from "next/server";
import { getPreset, composePrompt } from "@/lib/prompt-engine";
import { generateImage } from "@/lib/image-generation";
import type { ProcessRequest } from "@/types/preset";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  let body: ProcessRequest;
  try {
    body = (await req.json()) as ProcessRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.presetId || !Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json(
      { error: "Missing presetId or items" },
      { status: 400 }
    );
  }

  const preset = await getPreset(body.presetId);
  if (!preset) {
    return NextResponse.json(
      { error: `Preset not found: ${body.presetId}` },
      { status: 404 }
    );
  }

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

      for (let i = 0; i < body.items.length; i++) {
        const item = body.items[i];
        const prompt = composePrompt({
          preset,
          role: item.role,
          collection: item.collection,
          customPrompt: item.customPrompt ?? item.productNotes,
        });

        send({ index: i, status: "processing" });

        try {
          const result = await generateImage({
            modelSlug: item.modelSlug,
            prompt,
            sourceImageBase64: item.imageBase64,
            sourceMimeType: item.mimeType,
          });
          send({
            index: i,
            status: "done",
            imageBase64: result.imageBase64,
            mimeType: result.mimeType,
            prompt,
            modelUsed: result.modelUsed,
          });
        } catch (err) {
          send({
            index: i,
            status: "error",
            error: err instanceof Error ? err.message : "Unknown error",
            prompt,
          });
        }
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
