import type { ProcessRequest, ProcessResultItem } from "@/types/preset";

export type ImageStatus = "pending" | "processing" | "done" | "error";

interface StreamCallbacks {
  onProcessing: (index: number) => void;
  onResult: (result: ProcessResultItem) => void;
  onComplete: () => void;
  onStreamError: (message: string) => void;
}

// Core SSE reader — shared by processStream and reprocessStream
async function runSseStream(
  url: string,
  body: unknown,
  callbacks: StreamCallbacks
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    callbacks.onStreamError(
      err instanceof Error ? err.message : "Erro de ligação"
    );
    return;
  }

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const errData = (await res.json()) as { error?: string };
      if (errData.error) message = errData.error;
    } catch {
      // ignore
    }
    callbacks.onStreamError(message);
    return;
  }

  if (!res.body) {
    callbacks.onStreamError("Resposta sem body");
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";

      for (const block of blocks) {
        const line = block.trim();
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6);

        let event: Record<string, unknown>;
        try {
          event = JSON.parse(payload) as Record<string, unknown>;
        } catch {
          continue;
        }

        const status = event.status as string;
        const index = (event.index as number) ?? 0;

        if (status === "processing") {
          callbacks.onProcessing(index);
        } else if (status === "done") {
          callbacks.onResult({
            index,
            success: true,
            imageBase64: event.imageBase64 as string,
            mimeType: event.mimeType as string,
            prompt: event.prompt as string,
          });
        } else if (status === "error") {
          callbacks.onResult({
            index,
            success: false,
            error: event.error as string,
            prompt: event.prompt as string | undefined,
          });
        } else if (status === "complete") {
          callbacks.onComplete();
          return;
        }
      }
    }
    callbacks.onComplete();
  } catch (err) {
    callbacks.onStreamError(
      err instanceof Error ? err.message : "Erro ao ler stream"
    );
  } finally {
    reader.releaseLock();
  }
}

export async function processStream(
  body: ProcessRequest,
  callbacks: StreamCallbacks
): Promise<void> {
  return runSseStream("/api/process", body, callbacks);
}

// Regenerate a single image with an arbitrary full prompt.
// Calls /api/reprocess and fires callbacks with index always 0.
// resultIndex is added back to the result so callers can replace the right card.
export async function reprocessStream(
  imageBase64: string,
  mimeType: string,
  prompt: string,
  resultIndex: number,
  onDone: (result: ProcessResultItem) => void,
  onError: (message: string) => void
): Promise<void> {
  return runSseStream(
    "/api/reprocess",
    { imageBase64, mimeType, prompt },
    {
      onProcessing: () => {},
      onResult: (r) => {
        // Remap index 0 → resultIndex so the parent can replace the right card
        onDone({ ...r, index: resultIndex });
      },
      onComplete: () => {},
      onStreamError: onError,
    }
  );
}
