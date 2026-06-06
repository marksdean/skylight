// Live weather for the current view center via Open-Meteo (keyless, free).
// Cached briefly and refetched when the center moves meaningfully.

export interface WeatherSnapshot {
  tempC: number;
  windKph: number;
  cloudPct: number;
  /** WMO weather interpretation code. */
  code: number;
  isDay: boolean;
  label: string;
  lat: number;
  lon: number;
  updatedAt: number;
}

const TTL_MS = 10 * 60_000;
const MOVE_THRESHOLD_DEG = 0.2;

function describe(code: number): string {
  if (code === 0) return "Clear";
  if (code <= 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if (code <= 48) return "Fog";
  if (code <= 57) return "Drizzle";
  if (code <= 67) return "Rain";
  if (code <= 77) return "Snow";
  if (code <= 82) return "Showers";
  if (code <= 86) return "Snow showers";
  return "Thunderstorm";
}

export class WeatherStore {
  private snapshot: WeatherSnapshot | null = null;
  private inflight: Promise<void> | null = null;

  async get(lat: number, lon: number): Promise<WeatherSnapshot | null> {
    const stale =
      !this.snapshot ||
      Date.now() - this.snapshot.updatedAt > TTL_MS ||
      Math.abs(this.snapshot.lat - lat) > MOVE_THRESHOLD_DEG ||
      Math.abs(this.snapshot.lon - lon) > MOVE_THRESHOLD_DEG;
    if (stale && !this.inflight) {
      this.inflight = this.refresh(lat, lon).finally(() => {
        this.inflight = null;
      });
    }
    if (!this.snapshot && this.inflight) await this.inflight;
    return this.snapshot;
  }

  private async refresh(lat: number, lon: number): Promise<void> {
    try {
      const url =
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
        `&current=temperature_2m,weather_code,cloud_cover,wind_speed_10m,is_day` +
        `&wind_speed_unit=kmh`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return;
      const json = (await res.json()) as {
        current?: {
          temperature_2m?: number;
          weather_code?: number;
          cloud_cover?: number;
          wind_speed_10m?: number;
          is_day?: number;
        };
      };
      const c = json.current;
      if (!c) return;
      const code = c.weather_code ?? 0;
      this.snapshot = {
        tempC: Math.round(c.temperature_2m ?? 0),
        windKph: Math.round(c.wind_speed_10m ?? 0),
        cloudPct: Math.round(c.cloud_cover ?? 0),
        code,
        isDay: (c.is_day ?? 1) === 1,
        label: describe(code),
        lat,
        lon,
        updatedAt: Date.now(),
      };
    } catch {
      /* keep last snapshot */
    }
  }
}
