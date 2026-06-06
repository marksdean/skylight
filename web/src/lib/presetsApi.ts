import type { ConfigPreset } from "@shared/index.js";

export async function fetchPresets(): Promise<ConfigPreset[]> {
  const res = await fetch("/api/presets");
  if (!res.ok) throw new Error(`Presets failed (${res.status})`);
  return res.json() as Promise<ConfigPreset[]>;
}

export async function savePreset(name: string): Promise<ConfigPreset[]> {
  const res = await fetch("/api/presets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`Save preset failed (${res.status})`);
  return res.json() as Promise<ConfigPreset[]>;
}

export async function applyPreset(id: string): Promise<void> {
  const res = await fetch(`/api/presets/${encodeURIComponent(id)}/apply`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(`Apply preset failed (${res.status})`);
}

export async function deletePreset(id: string): Promise<ConfigPreset[]> {
  const res = await fetch(`/api/presets/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`Delete preset failed (${res.status})`);
  return res.json() as Promise<ConfigPreset[]>;
}
