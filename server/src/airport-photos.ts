// Proxy + cache Wikipedia lead images for airports (same-origin canvas use).

type CacheHit = { body: Buffer; contentType: string };
const cache = new Map<string, CacheHit | "miss">();

function wikiTitleFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (!u.hostname.includes("wikipedia.org")) return null;
    const parts = u.pathname.split("/");
    const idx = parts.indexOf("wiki");
    if (idx === -1 || !parts[idx + 1]) return null;
    return decodeURIComponent(parts[idx + 1]);
  } catch {
    return null;
  }
}

export async function fetchAirportPhoto(wikipediaLink: string): Promise<CacheHit | null> {
  const key = wikipediaLink.trim();
  if (!key) return null;

  const hit = cache.get(key);
  if (hit === "miss") return null;
  if (hit) return hit;

  const title = wikiTitleFromUrl(key);
  if (!title) {
    cache.set(key, "miss");
    return null;
  }

  try {
    const summaryRes = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
      { headers: { "User-Agent": "Skylight/0.1 (https://github.com/skylight)" } },
    );
    if (!summaryRes.ok) {
      cache.set(key, "miss");
      return null;
    }
    const summary = (await summaryRes.json()) as { thumbnail?: { source?: string } };
    const thumbUrl = summary.thumbnail?.source;
    if (!thumbUrl) {
      cache.set(key, "miss");
      return null;
    }

    const imgRes = await fetch(thumbUrl, { redirect: "follow" });
    if (!imgRes.ok) {
      cache.set(key, "miss");
      return null;
    }
    const body = Buffer.from(await imgRes.arrayBuffer());
    const contentType = imgRes.headers.get("content-type") ?? "image/jpeg";
    const entry = { body, contentType };
    cache.set(key, entry);
    return entry;
  } catch {
    cache.set(key, "miss");
    return null;
  }
}
