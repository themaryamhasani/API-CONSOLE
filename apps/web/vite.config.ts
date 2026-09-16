import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

const DEFAULT_WEB_PORT = 5280;
const DEFAULT_API_PORT = 5281;

function readRuntimeApiPort() {
  try {
    const file = path.join(repoRoot, "runtime", "api-console", "dev-ports.json");
    if (!fs.existsSync(file)) return null;
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    const port = Number(parsed?.api);
    return Number.isFinite(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repoRoot, "");
  const webPort = Number(env.WEB_PORT || process.env.WEB_PORT || DEFAULT_WEB_PORT);
  // Prefer the live API port written by main.cjs so a busy preferred port
  // (e.g. 5281 taken by another stack) does not leave Vite pointing at a stale process.
  const runtimeApi = readRuntimeApiPort();
  const preferredApi = Number(env.API_CONSOLE_PORT || process.env.API_CONSOLE_PORT || DEFAULT_API_PORT);
  const apiPort = runtimeApi || (Number.isFinite(preferredApi) && preferredApi > 0 ? preferredApi : DEFAULT_API_PORT);
  const explicitProxy = String(env.VITE_DEV_API_PROXY_TARGET || process.env.VITE_DEV_API_PROXY_TARGET || "").trim();
  const runtimeProxy = `http://127.0.0.1:${apiPort}`;
  // If an explicit proxy points at the preferred port but runtime moved (5282+), follow runtime.
  let apiProxyTarget = runtimeProxy;
  if (explicitProxy) {
    try {
      const explicitPort = Number(new URL(explicitProxy).port || (explicitProxy.startsWith("https") ? 443 : 80));
      if (!runtimeApi || explicitPort === runtimeApi) {
        apiProxyTarget = explicitProxy;
      }
    } catch {
      apiProxyTarget = explicitProxy;
    }
  }
  return {
    plugins: [react(), tailwindcss()],
    envDir: repoRoot,
    server: {
      // Listen on IPv4+IPv6 so hosts-file names (api.edus.ir → 127.0.0.1) work,
      // not only the localhost / ::1 binding.
      host: true,
      port: Number.isFinite(webPort) && webPort > 0 ? webPort : DEFAULT_WEB_PORT,
      // If 5280 is taken by something else, Vite picks the next free port instead of crashing.
      strictPort: false,
      // Vite 5+ blocks unknown Host headers; allow local *.edus.ir hosts-file aliases.
      allowedHosts: [
        "localhost",
        "127.0.0.1",
        "api.edus.ir",
        "api-console.edus.ir",
        ".edus.ir",
      ],
      proxy: {
        "^/api(?:/|$)": {
          target: apiProxyTarget,
          changeOrigin: true,
        },
      },
    },
    preview: {
      host: "127.0.0.1",
      port: Number(env.E2E_WEB_PORT || process.env.E2E_WEB_PORT || 5290),
      strictPort: true,
      proxy: {
        "^/api(?:/|$)": {
          target: String(env.E2E_API_URL || process.env.E2E_API_URL || "http://127.0.0.1:5291"),
          changeOrigin: true,
        },
      },
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
      },
    },
  };
});
