// Client-side cache for proxied airport photos (canvas drawImage).

type Listener = () => void;

class AirportPhotoCache {
  private images = new Map<string, HTMLImageElement | "failed">();
  private inflight = new Set<string>();
  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Begin loading if needed; returns the image when ready. */
  request(icao: string): HTMLImageElement | null {
    const key = icao.trim().toUpperCase();
    const hit = this.images.get(key);
    if (hit === "failed") return null;
    if (hit?.complete && hit.naturalWidth > 0) return hit;
    if (this.inflight.has(key)) return null;

    this.inflight.add(key);
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      this.inflight.delete(key);
      this.notify();
    };
    img.onerror = () => {
      this.inflight.delete(key);
      this.images.set(key, "failed");
      this.notify();
    };
    img.src = `/api/airport-photo/${encodeURIComponent(key)}`;
    this.images.set(key, img);
    return null;
  }

  /** Drop cached state when the configured airport changes. */
  forgetExcept(icao: string): void {
    const keep = icao.trim().toUpperCase();
    for (const key of this.images.keys()) {
      if (key !== keep) this.images.delete(key);
    }
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }
}

export const airportPhotos = new AirportPhotoCache();
