import { useEffect } from "react";
import { getAirport } from "@shared/airport-resolve.js";
import { ensureAirport } from "./airportApi.js";

/** Load runway geometry for the configured airport when it isn't bundled. */
export function useAirportLoader(icao: string | undefined): void {
  useEffect(() => {
    if (!icao || getAirport(icao)) return;
    let on = true;
    ensureAirport(icao).catch(() => {
      if (on) console.warn(`[airport] failed to load ${icao}`);
    });
    return () => {
      on = false;
    };
  }, [icao]);
}
