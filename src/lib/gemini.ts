/**
 * Image editing via kie.ai (Google Nano Banana proxy).
 * Flow: normalize to PNG → upload → createTask → poll until success → download as base64.
 */

import sharp from "sharp";
import { getConfigValue } from "./settings";

const KIE_API_BASE = "https://api.kie.ai";
const KIE_UPLOAD_BASE = "https://kieai.redpandaai.co";
const KIE_MODEL = "google/nano-banana-edit";
const POLL_INTERVAL_MS = 4_000;
const POLL_TIMEOUT_MS = 120_000;

export interface EditImageArgs {
  imageBase64: string;
  mimeType: string;
  prompt: string;
}

export interface EditImageResult {
  imageBase64: string;
  mimeType: string;
}

// kie.ai nano-banana-edit only accepts JPEG and PNG.
// Convert anything else (AVIF, WebP, HEIC, …) to PNG before upload.
const KIE_ACCEPTED = new Set(["image/jpeg", "image/jpg", "image/png"]);

async function ensurePng(
  imageBase64: string,
  mimeType: string
): Promise<{ imageBase64: string; mimeType: string }> {
  if (KIE_ACCEPTED.has(mimeType.toLowerCase())) {
    return { imageBase64, mimeType };
  }
  const input = Buffer.from(imageBase64, "base64");
  const pngBuffer = await sharp(input).png().toBuffer();
  return { imageBase64: pngBuffer.toString("base64"), mimeType: "image/png" };
}

async function getApiKey(): Promise<string> {
  const key = await getConfigValue("KIE_AI_API_KEY");
  if (!key) {
    throw new Error(
      "KIE_AI_API_KEY is not set. Add it via /settings or .env.local."
    );
  }
  return key;
}

async function uploadImage(
  imageBase64: string,
  mimeType: string,
  apiKey: string
): Promise<string> {
  const res = await fetch(`${KIE_UPLOAD_BASE}/api/file-base64-upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      base64Data: `data:${mimeType};base64,${imageBase64}`,
      uploadPath: "shop-ai",
    }),
  });

  const json = await res.json();
  if (!json.success) {
    throw new Error(`kie.ai upload failed: ${json.msg ?? res.status}`);
  }
  return json.data.downloadUrl as string;
}

async function createTask(
  imageUrl: string,
  prompt: string,
  apiKey: string
): Promise<string> {
  const res = await fetch(`${KIE_API_BASE}/api/v1/jobs/createTask`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: KIE_MODEL,
      input: {
        prompt,
        image_urls: [imageUrl],
      },
    }),
  });

  const json = await res.json();
  if (json.code !== 200) {
    throw new Error(`kie.ai createTask failed: ${json.msg ?? res.status}`);
  }
  return json.data.taskId as string;
}

async function pollForResult(taskId: string, apiKey: string): Promise<string> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const res = await fetch(
      `${KIE_API_BASE}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`,
      { headers: { Authorization: `Bearer ${apiKey}` } }
    );

    const json = await res.json();
    if (json.code !== 200) {
      throw new Error(`kie.ai poll failed: ${json.msg ?? res.status}`);
    }

    const { state, resultJson, failMsg } = json.data as {
      state: string;
      resultJson: string;
      failMsg: string;
    };

    if (state === "success") {
      const result = JSON.parse(resultJson) as { resultUrls?: string[] };
      const url = result.resultUrls?.[0];
      if (!url) throw new Error("kie.ai returned success but no output URL.");
      return url;
    }

    if (state === "fail") {
      throw new Error(`kie.ai task failed: ${failMsg || "unknown error"}`);
    }

    // state is "waiting" | "queuing" | "generating" — keep polling
  }

  throw new Error(`kie.ai task timed out after ${POLL_TIMEOUT_MS / 1000}s`);
}

async function downloadAsBase64(
  url: string
): Promise<{ imageBase64: string; mimeType: string }> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download result image: ${res.status}`);
  }
  const buffer = await res.arrayBuffer();
  const mimeType = res.headers.get("content-type") || "image/png";
  const imageBase64 = Buffer.from(buffer).toString("base64");
  return { imageBase64, mimeType };
}

export async function editImage(args: EditImageArgs): Promise<EditImageResult> {
  const { imageBase64, mimeType, prompt } = args;
  const apiKey = await getApiKey();

  const { imageBase64: pngBase64, mimeType: pngMime } = await ensurePng(imageBase64, mimeType);
  const imageUrl = await uploadImage(pngBase64, pngMime, apiKey);
  const taskId = await createTask(imageUrl, prompt, apiKey);
  const resultUrl = await pollForResult(taskId, apiKey);
  return downloadAsBase64(resultUrl);
}
