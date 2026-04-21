/**
 * Generic kie.ai API client — handles both endpoint patterns:
 *   1. Standard: /api/v1/jobs/createTask + /api/v1/jobs/recordInfo
 *   2. Flux:     /api/v1/flux/kontext/generate + /api/v1/flux/kontext/record-info
 */

import { getConfigValue } from "../settings";

const KIE_API_BASE = "https://api.kie.ai";
const KIE_UPLOAD_BASE = "https://kieai.redpandaai.co";
const POLL_INTERVAL_MS = 4_000;
const POLL_TIMEOUT_MS = 120_000;

export async function getApiKey(): Promise<string> {
  const key = await getConfigValue("KIE_AI_API_KEY");
  if (!key) {
    throw new Error("KIE_AI_API_KEY is not set. Add it via /settings or .env.local.");
  }
  return key;
}

/** Upload a base64 image to kie.ai's file storage, returns a download URL */
export async function uploadImage(
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

// ---------- Standard endpoint (createTask / recordInfo) ----------

export async function createStandardTask(
  apiKey: string,
  body: Record<string, unknown>
): Promise<string> {
  const res = await fetch(`${KIE_API_BASE}/api/v1/jobs/createTask`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const json = await res.json();
  if (json.code !== 200) {
    throw new Error(`kie.ai createTask failed: ${json.msg ?? res.status}`);
  }
  return json.data.taskId as string;
}

export async function pollStandardTask(
  taskId: string,
  apiKey: string
): Promise<string> {
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
  }

  throw new Error(`kie.ai task timed out after ${POLL_TIMEOUT_MS / 1000}s`);
}

// ---------- Flux endpoint (flux/kontext) ----------

export async function createFluxTask(
  apiKey: string,
  body: Record<string, unknown>
): Promise<string> {
  const res = await fetch(`${KIE_API_BASE}/api/v1/flux/kontext/generate`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const json = await res.json();
  if (json.code !== 200) {
    throw new Error(`kie.ai flux create failed: ${json.msg ?? res.status}`);
  }
  return json.data.taskId as string;
}

export async function pollFluxTask(
  taskId: string,
  apiKey: string
): Promise<string> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const res = await fetch(
      `${KIE_API_BASE}/api/v1/flux/kontext/record-info?taskId=${encodeURIComponent(taskId)}`,
      { headers: { Authorization: `Bearer ${apiKey}` } }
    );

    const json = await res.json();
    if (json.code !== 200) {
      throw new Error(`kie.ai flux poll failed: ${json.msg ?? res.status}`);
    }

    const { successFlag, response, errorMessage } = json.data as {
      successFlag: number;
      response?: { resultImageUrl?: string };
      errorMessage?: string;
    };

    // 0=GENERATING, 1=SUCCESS, 2=CREATE_FAILED, 3=GENERATE_FAILED
    if (successFlag === 1) {
      const url = response?.resultImageUrl;
      if (!url) throw new Error("Flux returned success but no result URL.");
      return url;
    }

    if (successFlag === 2 || successFlag === 3) {
      throw new Error(`Flux task failed: ${errorMessage || "unknown error"}`);
    }
  }

  throw new Error(`Flux task timed out after ${POLL_TIMEOUT_MS / 1000}s`);
}

// ---------- Download result ----------

export async function downloadAsBase64(
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
