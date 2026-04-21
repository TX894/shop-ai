/**
 * Image model catalog — hardcoded registry of kie.ai models.
 *
 * All models use the same kie.ai API key. Two endpoint patterns:
 *   1. Standard: POST /api/v1/jobs/createTask + GET /api/v1/jobs/recordInfo
 *   2. Flux:     POST /api/v1/flux/kontext/generate + GET /api/v1/flux/kontext/record-info
 *
 * ┌──────────────────────────┬──────────────────────────────────┬─────────┬──────────┐
 * │ Slug                     │ Model ID (kie.ai)                │ Editing │ Endpoint │
 * ├──────────────────────────┼──────────────────────────────────┼─────────┼──────────┤
 * │ nano-banana-edit         │ google/nano-banana-edit           │ Yes     │ standard │
 * │ nano-banana-2            │ nano-banana-2                    │ Yes     │ standard │
 * │ nano-banana-pro          │ nano-banana-pro                  │ Yes     │ standard │
 * │ imagen4                  │ google/imagen4                   │ No      │ standard │
 * │ imagen4-ultra            │ google/imagen4-ultra             │ No      │ standard │
 * │ flux-kontext-pro         │ flux-kontext-pro                 │ Yes     │ flux     │
 * │ flux-kontext-max         │ flux-kontext-max                 │ Yes     │ flux     │
 * │ seedream-4               │ bytedance/seedream-v4-text-to-image │ No   │ standard │
 * └──────────────────────────┴──────────────────────────────────┴─────────┴──────────┘
 *
 * Credits: kie.ai charges 10-50 credits per image depending on model.
 * Rate limit: 20 requests / 10 seconds across all models.
 */

export interface ImageModel {
  slug: string;
  displayName: string;
  kieModelId: string;
  endpointType: "standard" | "flux";
  supportsEditing: boolean;
  description: string;
  creditsPerImage: number;
}

export const IMAGE_MODELS: ImageModel[] = [
  {
    slug: "nano-banana-edit",
    displayName: "Nano Banana Edit",
    kieModelId: "google/nano-banana-edit",
    endpointType: "standard",
    supportsEditing: true,
    description: "Fast image editing via Gemini 2.5 Flash. Best for quick background/style swaps.",
    creditsPerImage: 4,
  },
  {
    slug: "nano-banana-2",
    displayName: "Nano Banana 2",
    kieModelId: "nano-banana-2",
    endpointType: "standard",
    supportsEditing: true,
    description: "Next-gen Gemini editing. Supports up to 4K and 14 reference images.",
    creditsPerImage: 8,
  },
  {
    slug: "nano-banana-pro",
    displayName: "Nano Banana Pro",
    kieModelId: "nano-banana-pro",
    endpointType: "standard",
    supportsEditing: true,
    description: "Premium Gemini editing. Up to 4K, 8 reference images, best prompt adherence.",
    creditsPerImage: 12,
  },
  {
    slug: "flux-kontext-pro",
    displayName: "Flux Kontext Pro",
    kieModelId: "flux-kontext-pro",
    endpointType: "flux",
    supportsEditing: true,
    description: "High-fidelity image editing. Excellent at preserving product details.",
    creditsPerImage: 10,
  },
  {
    slug: "flux-kontext-max",
    displayName: "Flux Kontext Max",
    kieModelId: "flux-kontext-max",
    endpointType: "flux",
    supportsEditing: true,
    description: "Maximum quality Flux editing. Best for hero shots needing perfection.",
    creditsPerImage: 20,
  },
  {
    slug: "imagen4",
    displayName: "Imagen 4",
    kieModelId: "google/imagen4",
    endpointType: "standard",
    supportsEditing: false,
    description: "Google Imagen 4 text-to-image. Great quality, no editing support.",
    creditsPerImage: 10,
  },
  {
    slug: "imagen4-ultra",
    displayName: "Imagen 4 Ultra",
    kieModelId: "google/imagen4-ultra",
    endpointType: "standard",
    supportsEditing: false,
    description: "Premium Imagen 4. Best prompt adherence, highest quality generation.",
    creditsPerImage: 20,
  },
  {
    slug: "seedream-4",
    displayName: "Seedream 4.0",
    kieModelId: "bytedance/seedream-v4-text-to-image",
    endpointType: "standard",
    supportsEditing: false,
    description: "ByteDance Seedream 4.0. Fast 2K generation, editorial product photography.",
    creditsPerImage: 8,
  },
];

export function getModel(slug: string): ImageModel | undefined {
  return IMAGE_MODELS.find((m) => m.slug === slug);
}

export function getEditingModels(): ImageModel[] {
  return IMAGE_MODELS.filter((m) => m.supportsEditing);
}

export function getAllModels(): ImageModel[] {
  return IMAGE_MODELS;
}

/** Default model for backwards compatibility */
export const DEFAULT_MODEL_SLUG = "nano-banana-edit";
