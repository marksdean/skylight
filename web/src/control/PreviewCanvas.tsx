import { useEffect, useRef } from "react";
import type { Aircraft, Config } from "@shared/index.js";
import { Renderer } from "../display/renderer.js";

/** A small live mirror of the display, driven by the same config + aircraft
 *  stream, so you can calibrate rotation/mirror without looking at the ceiling. */
export function PreviewCanvas({
  config,
  aircraft,
  now,
}: {
  config: Config;
  aircraft: Aircraft[];
  now: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const configRef = useRef<Config>(config);
  configRef.current = config;

  useEffect(() => {
    if (!canvasRef.current) return;
    const r = new Renderer(canvasRef.current, () => configRef.current);
    rendererRef.current = r;
    r.start();
    const onResize = () => r.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      r.stop();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    rendererRef.current?.update(aircraft);
  }, [now, aircraft]);

  return (
    <div className="preview-wrap">
      <canvas ref={canvasRef} className="preview-canvas" />
    </div>
  );
}
