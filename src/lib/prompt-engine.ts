import fs from "fs/promises";
import path from "path";
import type { Preset, ImageRole } from "@/types/preset";

const PRESETS_DIR = path.join(process.cwd(), "presets");

export async function listPresets(): Promise<Preset[]> {
  const files = await fs.readdir(PRESETS_DIR);
  const presets: Preset[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const raw = await fs.readFile(path.join(PRESETS_DIR, file), "utf-8");
    presets.push(JSON.parse(raw) as Preset);
  }
  return presets;
}

export async function getPreset(id: string): Promise<Preset | null> {
  try {
    const raw = await fs.readFile(
      path.join(PRESETS_DIR, `${id}.json`),
      "utf-8"
    );
    return JSON.parse(raw) as Preset;
  } catch {
    return null;
  }
}

export interface ComposePromptArgs {
  preset: Preset;
  role: ImageRole;
  collection?: string;
  customPrompt?: string;
  productNotes?: string; // legacy alias — prefer customPrompt
}

export function composePrompt(args: ComposePromptArgs): string {
  const { preset, role, collection } = args;
  const productNotes = args.customPrompt ?? args.productNotes;

  const layers: string[] = [];

  layers.push(
    "Edit the provided product image. Keep the exact same product — do not alter its shape, proportions, material, color, or any identifying features. Only change the background, lighting, and overall mood as described below."
  );

  layers.push(preset.base_prompt);

  const collectionKey = collection && preset.collection_presets[collection]
    ? collection
    : "general";
  const collectionPrompt = preset.collection_presets[collectionKey];
  if (collectionPrompt) {
    layers.push(collectionPrompt);
  }

  const rolePrompt = preset.image_roles[role];
  if (rolePrompt) {
    layers.push(rolePrompt);
  }

  if (productNotes && productNotes.trim().length > 0) {
    layers.push(`Specific instructions: ${productNotes.trim()}`);
  }

  layers.push(`Avoid: ${preset.negative}`);

  return layers.join(". ");
}
