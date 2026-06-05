// Proxy + cache airline tail logos (Kiwi CDN) for same-origin canvas use.

const KIWI_URL = (iata: string) => `https://images.kiwi.com/airlines/64x64/${iata}.png`;

type CacheHit = { body: Buffer; contentType: string };
const cache = new Map<string, CacheHit | "miss">();

export async function fetchCarrierLogo(iata: string): Promise<CacheHit | null> {
  const key = iata.trim().toUpperCase().slice(0, 2);
  if (!/^[A-Z0-9]{2}$/.test(key)) return null;

  const hit = cache.get(key);
  if (hit === "miss") return null;
  if (hit) return hit;

  try {
    const res = await fetch(KIWI_URL(key), { redirect: "follow" });
    if (!res.ok) {
      cache.set(key, "miss");
      return null;
    }
    const body = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get("content-type") ?? "image/png";
    const entry = { body, contentType };
    cache.set(key, entry);
    return entry;
  } catch {
    cache.set(key, "miss");
    return null;
  }
}
