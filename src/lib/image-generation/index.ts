/**
 * Unified image generation entry point.
 * Dispatches to the correct kie.ai adapter based on model slug.
 */

import sharp from "sharp";
import { getModel, DEFAULT_MODEL_SLUG, type ImageModel } from "./models";
import {
  getApiKey,
  uploadImage,
  createStandardTask,
  pollStandardTask,
  createFluxTask,
  pollFluxTask,
  downloadAsBase64,
} from "./kie-client";

export { IMAGE_MODELS, getAllModels, getEditingModels, getModel, DEFAULT_MODEL_SLUG } from "./models";
export type { ImageModel } from "./models";

export interface GenerateImageArgs {
  modelSlug?: string;
  prompt: string;
  /** Base64-encoded source image for editing models */
  sourceImageBase64?: string;
  sourceMimeType?: string;
  aspectRatio?: string;
}

export interface GenerateImageResult {
  imageBase64: string;
  mimeType: string;
  modelUsed: string;
  creditsUsed: number;
  processingTimeMs: number;
}

// kie.ai image editing models only accept JPEG and PNG
const ACCEPTED_MIMES = new Set(["image/jpeg", "image/jpg", "image/png"]);

async function ensurePng(
  imageBase64: string,
  mimeType: string
): Promise<{ imageBase64: string; mimeType: string }> {
  if (ACCEPTED_MIMES.has(mimeType.toLowerCase())) {
    return { imageBase64, mimeType };
  }
  const input = Buffer.from(imageBase64, "base64");
  const pngBuffer = await sharp(input).png().toBuffer();
  return { imageBase64: pngBuffer.toString("base64"), mimeType: "image/png" };
}

export async function generateImage(
  args: GenerateImageArgs
): Promise<GenerateImageResult> {
  const slug = args.modelSlug || DEFAULT_MODEL_SLUG;
  const model = getModel(slug);
  if (!model) {
    throw new Error(`Unknown image model: ${slug}`);
  }

  const startTime = Date.now();
  const apiKey = await getApiKey();

  let resultUrl: string;

  if (model.endpointType === "flux") {
    resultUrl = await runFluxModel(model, args, apiKey);
  } else {
    resultUrl = await runStandardModel(model, args, apiKey);
  }

  const { imageBase64, mimeType } = await downloadAsBase64(resultUrl);

  return {
    imageBase64,
    mimeType,
    modelUsed: model.slug,
    creditsUsed: model.creditsPerImage,
    processingTimeMs: Date.now() - startTime,
  };
}

// ---------- Standard endpoint models ----------

async function runStandardModel(
  model: ImageModel,
  args: GenerateImageArgs,
  apiKey: string
): Promise<string> {
  // Build the request body based on model capabilities
  const input: Record<string, unknown> = { prompt: args.prompt };

  if (model.supportsEditing && args.sourceImageBase64 && args.sourceMimeType) {
    // Models that support editing with source images
    const { imageBase64, mimeType } = await ensurePng(
      args.sourceImageBase64,
      args.sourceMimeType
    );
    const imageUrl = await uploadImage(imageBase64, mimeType, apiKey);

    if (model.kieModelId === "google/nano-banana-edit") {
      // nano-banana-edit uses image_urls array
      input.image_urls = [imageUrl];
      input.output_format = "png";
      if (args.aspectRatio) input.image_size = args.aspectRatio;
    } else {
      // nano-banana-2 and nano-banana-pro use image_input array
      input.image_input = [imageUrl];
      input.output_format = "png";
      if (args.aspectRatio) input.aspect_ratio = args.aspectRatio;
      else input.aspect_ratio = "auto";
    }
  } else if (!model.supportsEditing) {
    // Text-to-image models (Imagen 4, Seedream)
    if (model.kieModelId.startsWith("google/imagen4")) {
      if (args.aspectRatio) input.aspect_ratio = args.aspectRatio;
    } else if (model.kieModelId.includes("seedream")) {
      if (args.aspectRatio) input.image_size = args.aspectRatio;
      else input.image_size = "square_hd";
      input.image_resolution = "2K";
    }
  }

  const taskId = await createStandardTask(apiKey, {
    model: model.kieModelId,
    input,
  });

  return pollStandardTask(taskId, apiKey);
}

// ---------- Flux endpoint models ----------

async function runFluxModel(
  model: ImageModel,
  args: GenerateImageArgs,
  apiKey: string
): Promise<string> {
  const body: Record<string, unknown> = {
    prompt: args.prompt,
    model: model.kieModelId,
    outputFormat: "png",
    aspectRatio: args.aspectRatio || "1:1",
  };

  if (model.supportsEditing && args.sourceImageBase64 && args.sourceMimeType) {
    const { imageBase64, mimeType } = await ensurePng(
      args.sourceImageBase64,
      args.sourceMimeType
    );
    const imageUrl = await uploadImage(imageBase64, mimeType, apiKey);
    body.inputImage = imageUrl;
  }

  const taskId = await createFluxTask(apiKey, body);
  return pollFluxTask(taskId, apiKey);
}
