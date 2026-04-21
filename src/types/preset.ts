export type ImageRole = "hero" | "detail" | "lifestyle";

export interface Preset {
  id: string;
  name: string;
  description: string;
  base_prompt: string;
  collection_presets: Record<string, string>;
  image_roles: Record<ImageRole, string>;
  negative: string;
}

export interface ProcessRequestItem {
  imageBase64: string;
  mimeType: string;
  role: ImageRole;
  collection?: string;
  customPrompt?: string;
  productNotes?: string; // legacy alias — prefer customPrompt
  modelSlug?: string;
}

export interface ProcessRequest {
  presetId: string;
  items: ProcessRequestItem[];
}

export interface ProcessResultItem {
  index: number;
  success: boolean;
  imageBase64?: string;
  mimeType?: string;
  prompt?: string;
  error?: string;
}

export interface ProcessResponse {
  results: ProcessResultItem[];
}
