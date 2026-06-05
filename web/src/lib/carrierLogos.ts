// Client-side cache for proxied airline logo images (canvas drawImage).

type Listener = () => void;

class CarrierLogoCache {
  private images = new Map<string, HTMLImageElement | "failed">();
  private inflight = new Set<string>();
  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Begin loading if needed; returns the image when ready. */
  request(iata: string): HTMLImageElement | null {
    const key = iata.trim().toUpperCase().slice(0, 2);
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
    img.src = `/api/carrier-logo/${encodeURIComponent(key)}`;
    this.images.set(key, img);
    return null;
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }
}

export const carrierLogos = new CarrierLogoCache();
