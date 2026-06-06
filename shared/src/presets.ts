// Saved "scene" presets — named snapshots of the visual configuration.

import type { Config } from "./config.js";

/** Config fields that are tied to *where* you are, excluded when applying a
 *  scene so switching scenes never moves your view. */
export const PRESET_LOCATION_KEYS = [
  "airportIcao",
  "centerLat",
  "centerLon",
  "locationMode",
  "radiusMiles",
] as const satisfies readonly (keyof Config)[];

export interface ConfigPreset {
  id: string;
  name: string;
  /** Full config snapshot at save time. */
  config: Config;
  createdAt: number;
}

/** Strip location-bound keys so a scene only changes the look, not the place. */
export function presetVisualPatch(preset: ConfigPreset): Partial<Config> {
  const patch: Partial<Config> = { ...preset.config };
  for (const key of PRESET_LOCATION_KEYS) delete patch[key];
  return patch;
}
