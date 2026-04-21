/**
 * Shot type presets — suggested prompts per gallery slot type.
 * These are starting points the user can edit/replace freely.
 */

import type { ShotType } from "../gallery";

export interface ShotPreset {
  label: string;
  needsCharacter: boolean;
  suggestedPrompt: string;
}

export const SHOT_PRESETS: Record<ShotType, ShotPreset> = {
  hero: {
    label: "Hero (produto puro)",
    needsCharacter: false,
    suggestedPrompt:
      "Ultra-detailed editorial product photography of the jewelry piece on a clean cream seamless background, soft diffused lighting from above, centered composition, 4:5 vertical framing. Preserve the exact piece — same metal, same gemstones, same proportions. Photorealistic, shot as if on Phase One medium format, f/8, razor sharp focus.",
  },
  detail_macro: {
    label: "Detalhe macro",
    needsCharacter: false,
    suggestedPrompt:
      "Extreme macro close-up of the jewelry piece filling 80% of the frame, showing intricate craftsmanship details — stone facets, metal finish, prong settings. Dark moody background with single directional light creating dramatic highlights. Shallow depth of field. Preserve exact product.",
  },
  in_hand: {
    label: "Na mao (dona)",
    needsCharacter: true,
    suggestedPrompt:
      "Editorial lifestyle shot inside a warm British family-owned jewelry boutique. The shop owner (shown in reference image) gently holds the jewelry piece between her thumb and index finger, presenting it toward the viewer. Her hands in sharp focus, face softly out of focus in background with warm kind smile. Behind her, polished wooden counter with a gold plaque reading 'Audrey & Roman' in elegant serif. Warm afternoon light, honey-coloured glow, shallow DOF, 4:5 vertical. Boodles campaign aesthetic. Preserve exact jewelry and exact face from references.",
  },
  on_model: {
    label: "Modelo a usar",
    needsCharacter: true,
    suggestedPrompt:
      "Elegant lifestyle portrait of the woman (from reference image) wearing the jewelry piece naturally. Soft natural window light from the side, cream cashmere turtleneck, minimal styling. Three-quarter angle, focus on the jewelry integrated with her presence. Editorial, warm, timeless. 4:5 vertical. Preserve exact face and exact jewelry piece.",
  },
  in_box: {
    label: "Na caixa com logo",
    needsCharacter: false,
    suggestedPrompt:
      "The jewelry piece inside an open cream velvet jewelry box with 'Audrey & Roman' engraved in gold serif on the inner lid. Box on dark walnut wood surface, warm left lighting, three-quarter angle. Heritage British boutique aesthetic. Preserve exact product.",
  },
  lifestyle: {
    label: "Lifestyle (contexto)",
    needsCharacter: false,
    suggestedPrompt:
      "The jewelry piece in a styled flat lay on a cream linen surface, accompanied by heritage props — a vintage silver tea spoon, a small pressed flower, a folded cream silk ribbon. Natural window light from above, shot from directly overhead, 4:5. British cottagecore meets editorial. Preserve exact product.",
  },
  scale_compare: {
    label: "Comparacao de escala",
    needsCharacter: false,
    suggestedPrompt:
      "The jewelry piece held between thumb and index finger of an elegant hand against a soft cream background, showing the true size of the piece. Sharp focus on the jewelry, hand slightly out of focus. Clean, informative, trustworthy. Preserve exact product.",
  },
};

export function getShotPreset(type: ShotType): ShotPreset {
  return SHOT_PRESETS[type];
}

export function getAllShotPresets(): { type: ShotType; preset: ShotPreset }[] {
  return (Object.entries(SHOT_PRESETS) as [ShotType, ShotPreset][]).map(
    ([type, preset]) => ({ type, preset })
  );
}
