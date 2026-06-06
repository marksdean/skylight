// Persisted "scene" presets — named snapshots of the current config.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Config, ConfigPreset } from "@shared/index.js";

function makeId(): string {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export class PresetStore {
  private presets: ConfigPreset[] = [];

  constructor(private path: string) {}

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.path, "utf8");
      const parsed = JSON.parse(raw) as ConfigPreset[];
      if (Array.isArray(parsed)) this.presets = parsed;
    } catch {
      this.presets = [];
    }
  }

  list(): ConfigPreset[] {
    return this.presets;
  }

  add(name: string, config: Config): ConfigPreset {
    const clean = name.trim().slice(0, 60) || "Scene";
    const preset: ConfigPreset = {
      id: makeId(),
      name: clean,
      config,
      createdAt: Date.now(),
    };
    this.presets = [preset, ...this.presets].slice(0, 50);
    void this.save();
    return preset;
  }

  get(id: string): ConfigPreset | undefined {
    return this.presets.find((p) => p.id === id);
  }

  remove(id: string): boolean {
    const before = this.presets.length;
    this.presets = this.presets.filter((p) => p.id !== id);
    if (this.presets.length !== before) {
      void this.save();
      return true;
    }
    return false;
  }

  private async save(): Promise<void> {
    try {
      await mkdir(dirname(this.path), { recursive: true });
      await writeFile(this.path, JSON.stringify(this.presets, null, 2), "utf8");
    } catch (err) {
      console.error("[presets] save failed:", err);
    }
  }
}
