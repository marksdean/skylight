import { createLogger, defineConfig, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

const SHARED = resolve(__dirname, "../shared/src");
const SERVER = process.env.SERVER_URL ?? "http://localhost:3000";

const QUIET_PROXY_ERRORS = new Set(["EPIPE", "ECONNRESET", "ECONNREFUSED"]);

function isQuietProxyError(err: unknown): boolean {
  return (
    err instanceof Error &&
    "code" in err &&
    typeof err.code === "string" &&
    QUIET_PROXY_ERRORS.has(err.code)
  );
}

const logger = createLogger();
const logError = logger.error.bind(logger);
logger.error = (msg, options) => {
  if (
    typeof msg === "string" &&
    (msg.includes("ws proxy socket error") || msg.includes("http proxy error")) &&
    isQuietProxyError(options?.error)
  ) {
    return;
  }
  logError(msg, options);
};

function backendProxy(): Pick<ProxyOptions, "configure"> {
  return {
    configure: (proxy, _options) => {
      proxy.on("error", (err: Error) => {
        if (!isQuietProxyError(err)) console.error("[vite proxy]", err);
      });
    },
  };
}

export default defineConfig({
  customLogger: logger,
  plugins: [react()],
  resolve: {
    alias: { "@shared": SHARED },
  },
  server: {
    host: true, // expose dev server on LAN too
    fs: { allow: [resolve(__dirname, ".."), SHARED] },
    proxy: {
      "/api": { target: SERVER, changeOrigin: true, ...backendProxy() },
      "/ws": { target: SERVER, ws: true, changeOrigin: true, ...backendProxy() },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, "index.html"),
        control: resolve(__dirname, "control.html"),
      },
    },
  },
});
