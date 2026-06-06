declare module "tz-lookup" {
  /** Returns the IANA time-zone name for a lat/lon. Throws on invalid input. */
  export default function tzlookup(lat: number, lon: number): string;
}
