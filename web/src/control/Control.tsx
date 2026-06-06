import { useEffect, useMemo, useState } from "react";
import type { Config, ConfigPreset, ShowFields } from "@shared/index.js";
import { activeMeteorShowers } from "@shared/index.js";
import {
  AIRPORT_CATALOG,
  getAirport,
  listAirportGroups,
  type ActiveAirportSummary,
  type AirportSearchResult,
  type NearbyAirportSummary,
} from "@shared/airport-resolve.js";
import {
  fetchActiveAirports,
  fetchNearbyAirports,
  fetchSearchAirports,
  getCurrentPosition,
  selectAirport,
  selectPosition,
} from "../lib/airportApi.js";
import { applyPreset, deletePreset, fetchPresets, savePreset } from "../lib/presetsApi.js";
import { useAirportLoader } from "../lib/useAirportLoader.js";
import { unlockOverheadAudio, playOverheadPass } from "../lib/overheadSound.js";
import { useOverheadAlert } from "../lib/useOverheadAlert.js";
import { useStream } from "../lib/useStream.js";
import { nextISSPass, type Tle } from "../display/celestial.js";
import { PreviewCanvas } from "./PreviewCanvas.js";
import { ColorRow, Row, Section, Segmented, Select, Slider, TextInput, Toggle } from "./components.js";

function skyTimeLabel(offsetMin: number): string {
  if (offsetMin === 0) return "live";
  const d = new Date(Date.now() + offsetMin * 60000);
  return d.toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });
}

function fmtIn(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function formatRelativeTime(ts: number): string {
  const sec = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  return `${hr}h ago`;
}

const FIELD_LABELS: Record<keyof ShowFields, string> = {
  airline: "Airline",
  flight: "Flight",
  type: "Type",
  altitude: "Altitude",
  speed: "Speed",
  verticalRate: "Vert. rate",
  destination: "Destination",
  registration: "Registration",
};

export function Control() {
  const { state, conn } = useStream("control");
  const cfg = state.config;

  // ISS pass finder (for the Sky section).
  const [tles, setTles] = useState<Tle[]>([]);
  useEffect(() => {
    let on = true;
    fetch("/api/tle")
      .then((r) => (r.ok ? r.json() : []))
      .then((t) => on && setTles(t as Tle[]))
      .catch(() => {});
    return () => {
      on = false;
    };
  }, []);
  const nextPass = useMemo(
    () => (tles.length && cfg ? nextISSPass(Date.now(), cfg.centerLat, cfg.centerLon, tles) : null),
    [tles, cfg?.centerLat, cfg?.centerLon],
  );

  const [nearby, setNearby] = useState<NearbyAirportSummary[]>([]);
  const [nearbyLoading, setNearbyLoading] = useState(false);
  const [positionLoading, setPositionLoading] = useState(false);
  const [nearbyError, setNearbyError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchKind, setSearchKind] = useState<"airport" | "heliport">("airport");
  const [searchResults, setSearchResults] = useState<AirportSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [active, setActive] = useState<ActiveAirportSummary[]>([]);
  const [activeLoading, setActiveLoading] = useState(false);
  const [activeRefreshing, setActiveRefreshing] = useState(false);
  const [activeUpdatedAt, setActiveUpdatedAt] = useState<number | null>(null);
  const [presets, setPresets] = useState<ConfigPreset[]>([]);
  const [presetName, setPresetName] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  useAirportLoader(cfg?.airportIcao);
  useOverheadAlert(cfg ?? undefined, state.aircraft);

  useEffect(() => {
    void fetchPresets()
      .then(setPresets)
      .catch(() => {});
  }, []);

  const showers = useMemo(() => activeMeteorShowers(), []);

  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }
    let on = true;
    const timer = setTimeout(() => {
      setSearchLoading(true);
      void fetchSearchAirports(q, 15, searchKind)
        .then((hits) => on && setSearchResults(hits))
        .catch(() => on && setSearchResults([]))
        .finally(() => on && setSearchLoading(false));
    }, 300);
    return () => {
      on = false;
      clearTimeout(timer);
    };
  }, [searchQuery, searchKind]);

  useEffect(() => {
    if (!activeRefreshing) return;
    const timer = setInterval(() => {
      void fetchActiveAirports(12, false, searchKind)
        .then((data) => {
          setActive(data.airports);
          setActiveUpdatedAt(data.updatedAt);
          setActiveRefreshing(data.refreshing);
        })
        .catch(() => {});
    }, 8000);
    return () => clearInterval(timer);
  }, [activeRefreshing, searchKind]);

  useEffect(() => {
    // Switching airport/heliport mode invalidates the current "busiest" list.
    setActive([]);
    setActiveUpdatedAt(null);
    setActiveRefreshing(false);
  }, [searchKind]);

  const staticIcaos = useMemo(
    () => new Set(listAirportGroups().flatMap((g) => g.icaos)),
    [],
  );
  const selectedEntry = cfg ? getAirport(cfg.airportIcao) : undefined;
  const selectedIsDynamic =
    !!cfg && !staticIcaos.has(cfg.airportIcao) && !nearby.some((ap) => ap.icao === cfg.airportIcao);

  async function pickAirport(icao: string): Promise<void> {
    try {
      const patch = await selectAirport(icao);
      conn.patchConfig(patch);
    } catch {
      setNearbyError("Could not load that airport.");
    }
  }

  function loadActiveAirports(refresh = false): void {
    setActiveLoading(true);
    setNearbyError(null);
    void fetchActiveAirports(12, refresh, searchKind)
      .then((data) => {
        setActive(data.airports);
        setActiveUpdatedAt(data.updatedAt);
        setActiveRefreshing(data.refreshing);
      })
      .catch(() =>
        setNearbyError(`Could not load active ${searchKind === "heliport" ? "heliports" : "airports"}.`),
      )
      .finally(() => setActiveLoading(false));
  }

  function saveCurrentPreset(): void {
    const name = presetName.trim();
    if (!name) return;
    void savePreset(name)
      .then((list) => {
        setPresets(list);
        setPresetName("");
      })
      .catch(() => setNearbyError("Could not save scene."));
  }

  function removePreset(id: string): void {
    void deletePreset(id)
      .then(setPresets)
      .catch(() => setNearbyError("Could not delete scene."));
  }

  function findAirportsNearMe(): void {
    setNearbyLoading(true);
    setNearbyError(null);
    void getCurrentPosition().then(async (pos) => {
      if (!pos.ok) {
        setNearbyError(pos.error);
        setNearbyLoading(false);
        return;
      }
      try {
        const hits = await fetchNearbyAirports(pos.lat, pos.lon);
        setNearby(hits);
        if (!hits.length) setNearbyError("No scheduled airports with runways found within 120 mi.");
      } catch {
        setNearbyError("Could not search for nearby airports.");
      } finally {
        setNearbyLoading(false);
      }
    });
  }

  function useMyPosition(): void {
    setPositionLoading(true);
    setNearbyError(null);
    void getCurrentPosition().then(async (pos) => {
      if (!pos.ok) {
        setNearbyError(pos.error);
        setPositionLoading(false);
        return;
      }
      try {
        const patch = await selectPosition(pos.lat, pos.lon);
        conn.patchConfig(patch);
      } catch {
        setNearbyError("Could not update location.");
      } finally {
        setPositionLoading(false);
      }
    });
  }

  if (!cfg) {
    return (
      <div className="loading">
        <div className={`dot ${state.connected ? "ok" : "bad"}`} />
        {state.connected ? "Loading config…" : "Connecting to tracker…"}
      </div>
    );
  }

  const set = (patch: Partial<Config>) => conn.patchConfig(patch);
  const setField = (k: keyof ShowFields, v: boolean) =>
    conn.patchConfig({ showFields: { ...cfg.showFields, [k]: v } });

  return (
    <div className="control">
      <header className="topbar">
        <div className="brand">
          <span className={`dot ${state.connected ? "ok" : "bad"}`} />
          Ceiling Tracker
        </div>
        <div className="stat">
          {state.status?.source ?? "—"} · {state.aircraft.length} overhead
        </div>
      </header>

      <main>
        <Section title="Preview">
          <Row label="Live preview" hint="mirror the ceiling here">
            <Toggle value={showPreview} onChange={setShowPreview} />
          </Row>
          {showPreview && (
            <PreviewCanvas config={cfg} aircraft={state.aircraft} now={state.now} />
          )}
        </Section>

        <Section title="Location">
          <Row label="Center" hint="airport field or your GPS position">
            <Select
              value={cfg.locationMode === "position" ? "__position__" : cfg.airportIcao}
              onChange={(v) => {
                if (v !== "__position__") void pickAirport(v);
              }}
            >
              {cfg.locationMode === "position" && (
                <optgroup label="Observer">
                  <option value="__position__">
                    My position ({cfg.centerLat.toFixed(4)}°, {cfg.centerLon.toFixed(4)}°)
                  </option>
                </optgroup>
              )}
              {active.length > 0 && (
                <optgroup label="Busiest right now">
                  {active.map((ap) => (
                    <option key={ap.icao} value={ap.icao}>
                      {ap.label} ({ap.aircraftCount} ac)
                    </option>
                  ))}
                </optgroup>
              )}
              {nearby.length > 0 && (
                <optgroup label="Near you">
                  {nearby.map((ap) => (
                    <option key={ap.icao} value={ap.icao}>
                      {ap.label} ({ap.distanceMi} mi)
                    </option>
                  ))}
                </optgroup>
              )}
              {selectedIsDynamic && selectedEntry && (
                <optgroup label="Selected">
                  <option value={selectedEntry.icao}>{selectedEntry.label}</option>
                </optgroup>
              )}
              {listAirportGroups().map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.icaos.map((icao) => (
                    <option key={icao} value={icao}>
                      {AIRPORT_CATALOG[icao]?.label ?? icao}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </Row>
          <Row label="Search for" hint="airports or heliports">
            <Segmented
              value={searchKind}
              options={[
                { value: "airport", label: "Airports" },
                { value: "heliport", label: "Heliports" },
              ]}
              onChange={(v) => setSearchKind(v as "airport" | "heliport")} />
          </Row>
          <Row label="Search" hint="name, IATA, or ICAO">
            <TextInput
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder={
                searchLoading
                  ? "Searching…"
                  : searchKind === "heliport"
                    ? "e.g. JRB, Battersea"
                    : "e.g. SFO, Heathrow"
              }
            />
          </Row>
          {searchQuery.trim().length >= 2 && (
            <div className="search-results">
              {searchLoading && searchResults.length === 0 && (
                <div className="search-empty">Searching…</div>
              )}
              {!searchLoading && searchResults.length === 0 && (
                <div className="search-empty">
                  No {searchKind === "heliport" ? "heliports" : "airports"} found.
                </div>
              )}
              {searchResults.map((ap) => (
                <button
                  key={ap.icao}
                  type="button"
                  className={`search-result ${cfg.airportIcao === ap.icao ? "on" : ""}`}
                  onClick={() => void pickAirport(ap.icao)}
                >
                  <span className="search-result-label">{ap.label}</span>
                  <span className="search-result-code">{ap.icao}</span>
                </button>
              ))}
            </div>
          )}
          <div className="chips">
            <button
              type="button"
              className={`chip ${cfg.locationMode === "position" ? "on" : ""} ${positionLoading ? "on" : ""}`}
              disabled={positionLoading}
              onClick={useMyPosition}
            >
              {positionLoading ? "Locating…" : "Use my position"}
            </button>
            <button
              type="button"
              className={`chip ${nearbyLoading ? "on" : ""}`}
              disabled={nearbyLoading}
              onClick={findAirportsNearMe}
            >
              {nearbyLoading ? "Locating…" : "Airports near me"}
            </button>
            <button
              type="button"
              className={`chip ${activeLoading || activeRefreshing ? "on" : ""}`}
              disabled={activeLoading}
              onClick={() => loadActiveAirports(false)}
            >
              {activeLoading || activeRefreshing
                ? "Scanning traffic…"
                : searchKind === "heliport"
                  ? "Busiest heliports now"
                  : "Busiest right now"}
            </button>
          </div>
          {activeUpdatedAt && (
            <div className="hint">
              Live traffic ranking updated {formatRelativeTime(activeUpdatedAt)}
              {activeRefreshing ? " · scan in progress" : ""}
            </div>
          )}
          {active.length > 0 && (
            <div className="chips">
              {active.map((ap) => (
                <button
                  key={ap.icao}
                  type="button"
                  className={`chip ${cfg.airportIcao === ap.icao ? "on" : ""}`}
                  onClick={() => void pickAirport(ap.icao)}
                >
                  {ap.iata || ap.icao} · {ap.aircraftCount} {searchKind === "heliport" ? "heli" : "ac"}
                </button>
              ))}
            </div>
          )}
          <Row label="Airport tour" hint="auto-cycle the busiest airports">
            <Toggle value={cfg.airportTour} onChange={(v) => set({ airportTour: v })} />
          </Row>
          {cfg.airportTour && (
            <Row label="Hop every">
              <Slider value={cfg.airportTourIntervalSec} min={5} max={300} step={5} unit="s"
                onChange={(v) => set({ airportTourIntervalSec: v })} />
            </Row>
          )}
          {cfg.locationMode === "position" && (
            <>
              <Row label="Overhead alert" hint="jet sound when a plane passes above you">
                <Toggle
                  value={cfg.overheadAlert}
                  onChange={(v) => {
                    if (v) unlockOverheadAudio();
                    set({ overheadAlert: v });
                  }}
                />
              </Row>
              {cfg.overheadAlert && (
                <div className="chips">
                  <button
                    type="button"
                    className="chip"
                    onClick={() => {
                      unlockOverheadAudio();
                      playOverheadPass();
                    }}
                  >
                    Test alert sound
                  </button>
                </div>
              )}
              <div className="hint">
                Overhead traffic is centered on your GPS position. Pick an airport to switch back.
              </div>
            </>
          )}
          {nearbyError && <div className="hint error">{nearbyError}</div>}
          {nearby.length > 0 && (
            <div className="chips">
              {nearby.map((ap) => (
                <button
                  key={ap.icao}
                  type="button"
                  className={`chip ${cfg.airportIcao === ap.icao ? "on" : ""}`}
                  onClick={() => void pickAirport(ap.icao)}
                >
                  {ap.iata || ap.icao} · {ap.distanceMi} mi
                </button>
              ))}
            </div>
          )}
        </Section>

        <Section title="Calibration">
          <Row label="Rotation" hint="align field to ceiling">
            <Slider value={cfg.rotationDeg} min={0} max={355} step={5} unit="°"
              onChange={(v) => set({ rotationDeg: v })} />
          </Row>
          <Row label="Mirror horizontally" hint="looking-up flip">
            <Toggle value={cfg.mirrorX} onChange={(v) => set({ mirrorX: v })} />
          </Row>
          <Row label="Mirror vertically">
            <Toggle value={cfg.mirrorY} onChange={(v) => set({ mirrorY: v })} />
          </Row>
          <Row label="Label rotation" hint="text only, not the map">
            <Slider value={cfg.labelRotationDeg} min={0} max={355} step={5} unit="°"
              onChange={(v) => set({ labelRotationDeg: v })} />
          </Row>
          <Row
            label="Auto-fit airport"
            hint={cfg.airportTour ? "always on during airport tour" : "zoom so runways fill the screen"}
          >
            <Toggle
              value={cfg.autoZoomAirport || cfg.airportTour}
              disabled={cfg.airportTour}
              onChange={(v) => set({ autoZoomAirport: v })}
            />
          </Row>
          <Row
            label="Radius"
            hint={
              (cfg.autoZoomAirport || cfg.airportTour) && cfg.locationMode === "airport"
                ? "auto-fit on — manual radius ignored"
                : undefined
            }
          >
            <Slider value={cfg.radiusMiles} min={0.5} max={10} step={0.5} unit="mi"
              onChange={(v) => set({ radiusMiles: v })} />
          </Row>
        </Section>

        <Section title="View">
          <Row label="Theme">
            <Segmented value={cfg.theme}
              options={[
                { value: "ambient", label: "Ambient" },
                { value: "telemetry", label: "Telemetry" },
                { value: "focus", label: "Focus" },
                { value: "basic", label: "Basic" },
              ]}
              onChange={(v) => set({ theme: v })} />
          </Row>
          <Row label="Brightness">
            <Slider value={cfg.brightness} min={0.1} max={1} step={0.05}
              onChange={(v) => set({ brightness: v })} />
          </Row>
          <Row label="Glyph size">
            <Slider value={cfg.glyphSizePx} min={6} max={40} step={1} unit="px"
              onChange={(v) => set({ glyphSizePx: v })} />
          </Row>
          <Row label="Glyph style" hint="outline reads clearer over busy maps">
            <Segmented
              value={cfg.glyphStyle}
              options={[
                { value: "filled", label: "Filled" },
                { value: "outline", label: "Outline" },
                { value: "contour", label: "Contour" },
              ]}
              onChange={(v) => set({ glyphStyle: v })} />
          </Row>
          <Row label="Carrier badge" hint="under each glyph">
            <Toggle value={cfg.showCarrierBadge} onChange={(v) => set({ showCarrierBadge: v })} />
          </Row>
          {cfg.showCarrierBadge && (
            <Row label="Badge style">
              <Segmented
                value={cfg.carrierBadgeStyle}
                options={[
                  { value: "code", label: "Code" },
                  { value: "logo", label: "Logo" },
                ]}
                onChange={(v) => set({ carrierBadgeStyle: v })}
              />
            </Row>
          )}
          <Row label="Trail length">
            <Slider value={cfg.trailSeconds} min={0} max={120} step={5} unit="s"
              onChange={(v) => set({ trailSeconds: v })} />
          </Row>
          <Row label="Color by altitude">
            <Toggle value={cfg.altitudeColor} onChange={(v) => set({ altitudeColor: v })} />
          </Row>
          <Row label="Highlight rare aircraft" hint="A380, 747, heavies, military">
            <Toggle value={cfg.highlightRare} onChange={(v) => set({ highlightRare: v })} />
          </Row>
        </Section>

        <Section title="Labels">
          <Row label="Density">
            <Segmented value={cfg.labelDensity}
              options={[
                { value: "all", label: "All" },
                { value: "nearestN", label: "Nearest N" },
                { value: "nearestOnly", label: "Nearest" },
              ]}
              onChange={(v) => set({ labelDensity: v })} />
          </Row>
          {cfg.labelDensity === "nearestN" && (
            <Row label="N">
              <Slider value={cfg.nearestN} min={1} max={20} step={1}
                onChange={(v) => set({ nearestN: v })} />
            </Row>
          )}
          <div className="chips">
            {(Object.keys(FIELD_LABELS) as (keyof ShowFields)[]).map((k) => (
              <button key={k}
                className={`chip ${cfg.showFields[k] ? "on" : ""}`}
                onClick={() => setField(k, !cfg.showFields[k])}>
                {FIELD_LABELS[k]}
              </button>
            ))}
          </div>
        </Section>

        <Section title="Filters">
          <Row label="Min altitude" hint="hide ground/taxi">
            <Slider value={cfg.minAltitudeFt} min={0} max={10000} step={100} unit="ft"
              onChange={(v) => set({ minAltitudeFt: v })} />
          </Row>
          <Row label="Max altitude">
            <Slider value={cfg.maxAltitudeFt} min={1000} max={60000} step={1000} unit="ft"
              onChange={(v) => set({ maxAltitudeFt: v })} />
          </Row>
          <Row label="Hide aircraft on ground">
            <Toggle value={cfg.hideOnGround} onChange={(v) => set({ hideOnGround: v })} />
          </Row>
        </Section>

        <Section title="Motion">
          <Row label="Interpolate">
            <Toggle value={cfg.interpolate} onChange={(v) => set({ interpolate: v })} />
          </Row>
          <Row label="Smoothing" hint="0 snap · 1 slow">
            <Slider value={cfg.smoothing} min={0} max={0.9} step={0.02}
              onChange={(v) => set({ smoothing: v })} />
          </Row>
          <Row label="Max extrapolation">
            <Slider value={cfg.maxExtrapolationSec} min={0} max={15} step={1} unit="s"
              onChange={(v) => set({ maxExtrapolationSec: v })} />
          </Row>
          <Row label="Drop after">
            <Slider value={cfg.staleSec} min={5} max={60} step={1} unit="s"
              onChange={(v) => set({ staleSec: v })} />
          </Row>
          <Row label="Max FPS" hint="0 = uncapped">
            <Slider value={cfg.maxFps} min={0} max={120} step={5} unit="fps"
              onChange={(v) => set({ maxFps: v })} />
          </Row>
        </Section>

        <Section title="Overlays">
          <Row label="Range rings">
            <Toggle value={cfg.rangeRings} onChange={(v) => set({ rangeRings: v })} />
          </Row>
          <Row label="Compass">
            <Toggle value={cfg.compass} onChange={(v) => set({ compass: v })} />
          </Row>
          <Row label="Airport runways">
            <Toggle value={cfg.showAirport} onChange={(v) => set({ showAirport: v })} />
          </Row>
          <Row label="Highlight emergency">
            <Toggle value={cfg.highlightEmergency} onChange={(v) => set({ highlightEmergency: v })} />
          </Row>
          <Row label="On-screen HUD (display)">
            <Toggle value={cfg.showHud} onChange={(v) => set({ showHud: v })} />
          </Row>
        </Section>

        <Section title="Sky">
          <Row label="Stars">
            <Toggle value={cfg.showStars} onChange={(v) => set({ showStars: v })} />
          </Row>
          <Row label="Sun">
            <Toggle value={cfg.showSun} onChange={(v) => set({ showSun: v })} />
          </Row>
          <Row label="Moon">
            <Toggle value={cfg.showMoon} onChange={(v) => set({ showMoon: v })} />
          </Row>
          <Row label="Satellites & ISS">
            <Toggle value={cfg.showSatellites} onChange={(v) => set({ showSatellites: v })} />
          </Row>
          <Row label="Star density">
            <Slider value={cfg.starMagLimit} min={1} max={4} step={0.1}
              onChange={(v) => set({ starMagLimit: v })} />
          </Row>
          <Row label="Meteor showers" hint={
            showers.length ? `active: ${showers.map((s) => s.name).join(", ")}` : "none active now"
          }>
            <Toggle value={cfg.showMeteorShowers} onChange={(v) => set({ showMeteorShowers: v })} />
          </Row>
          <Row label="Day / night tint" hint="subtle sky-color wash">
            <Toggle value={cfg.dayNightTint} onChange={(v) => set({ dayNightTint: v })} />
          </Row>
          <Row label="Weather readout" hint="live, via Open-Meteo">
            <Toggle value={cfg.showWeather} onChange={(v) => set({ showWeather: v })} />
          </Row>
          <Row label="Sky time" hint={skyTimeLabel(cfg.skyTimeOffsetMin)}>
            <Slider value={cfg.skyTimeOffsetMin} min={-720} max={720} step={5} unit="m"
              onChange={(v) => set({ skyTimeOffsetMin: v })} />
          </Row>
          <div className="chips">
            <button className={`chip ${cfg.skyTimeOffsetMin === 0 ? "on" : ""}`}
              onClick={() => set({ skyTimeOffsetMin: 0 })}>
              Live
            </button>
            {nextPass && (
              <button className="chip on"
                onClick={() => set({ skyTimeOffsetMin: Math.round((nextPass - Date.now()) / 60000) })}>
                ISS pass in {fmtIn(nextPass - Date.now())} → jump
              </button>
            )}
          </div>
        </Section>

        <Section title="Window to elsewhere">
          <Row label="Destination arcs" hint="great-circle toward dest">
            <Toggle value={cfg.showDestArc} onChange={(v) => set({ showDestArc: v })} />
          </Row>
          <Row label="Local time & distance">
            <Toggle value={cfg.showRouteDetail} onChange={(v) => set({ showRouteDetail: v })} />
          </Row>
          <Row label="Destination ticker" hint="scrolling list along the bottom">
            <Toggle value={cfg.showDestTicker} onChange={(v) => set({ showDestTicker: v })} />
          </Row>
        </Section>

        <Section title="Palette">
          <div className="palette">
            <ColorRow label="Background" value={cfg.palette.bg}
              onChange={(v) => set({ palette: { ...cfg.palette, bg: v } })} />
            <ColorRow label="Glyph" value={cfg.palette.glyph}
              onChange={(v) => set({ palette: { ...cfg.palette, glyph: v } })} />
            <ColorRow label="Ground" value={cfg.palette.ground}
              onChange={(v) => set({ palette: { ...cfg.palette, ground: v } })} />
            <ColorRow label="Trail" value={cfg.palette.trail}
              onChange={(v) => set({ palette: { ...cfg.palette, trail: v } })} />
            <ColorRow label="Accent" value={cfg.palette.accent}
              onChange={(v) => set({ palette: { ...cfg.palette, accent: v } })} />
            <ColorRow label="Warn" value={cfg.palette.warn}
              onChange={(v) => set({ palette: { ...cfg.palette, warn: v } })} />
            <ColorRow label="Grid" value={cfg.palette.grid}
              onChange={(v) => set({ palette: { ...cfg.palette, grid: v } })} />
            <ColorRow label="Text" value={cfg.palette.text}
              onChange={(v) => set({ palette: { ...cfg.palette, text: v } })} />
          </div>
        </Section>

        <Section title="Scenes">
          <Row label="Save current look" hint="visual settings, not location">
            <div className="scene-save">
              <TextInput
                value={presetName}
                onChange={setPresetName}
                placeholder="e.g. Dinner ambient"
              />
            </div>
          </Row>
          <div className="chips">
            <button
              type="button"
              className="chip"
              disabled={!presetName.trim()}
              onClick={saveCurrentPreset}
            >
              Save scene
            </button>
          </div>
          {presets.length === 0 ? (
            <div className="hint">No saved scenes yet.</div>
          ) : (
            <div className="search-results">
              {presets.map((p) => (
                <div key={p.id} className="scene-row">
                  <button
                    type="button"
                    className="scene-apply"
                    onClick={() => void applyPreset(p.id)}
                  >
                    {p.name}
                  </button>
                  <button
                    type="button"
                    className="scene-delete"
                    aria-label={`Delete ${p.name}`}
                    onClick={() => removePreset(p.id)}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title="System">
          <div className="hint">
            On the display: press <b>s</b> to save a screenshot, <b>h</b> for the HUD.
          </div>
          <button className="reset" onClick={() => conn.resetConfig()}>
            Reset all to defaults
          </button>
        </Section>
      </main>
    </div>
  );
}
