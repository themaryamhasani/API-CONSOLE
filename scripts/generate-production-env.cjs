const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
function secret(n = 32) {
  return crypto.randomBytes(n).toString("base64url");
}
const root = path.resolve(__dirname, "..");
const out = path.join(root, ".env.production");
if (fs.existsSync(out)) {
  console.error(".env.production already exists — refuse to overwrite");
  process.exit(1);
}
const pg = secret();
const lines = [
  "# Generated for local Docker Compose / v1. DO NOT COMMIT.",
  "# On edus host: set PUBLIC_URL/CORS to https://api-console.edus.ir and COOKIE_SECURE=true",
  "",
  "NODE_ENV=production",
  "",
  "API_CONSOLE_PUBLIC_URL=http://localhost:8080",
  "API_CONSOLE_CORS_ORIGIN=http://localhost:8080",
  "API_CONSOLE_COOKIE_SECURE=false",
  "WEB_PUBLISH_PORT=8080",
  "",
  "POSTGRES_USER=apiconsole",
  "POSTGRES_PASSWORD=" + pg,
  "POSTGRES_DB=api_console",
  "",
  "API_CONSOLE_PORT=5281",
  "API_CONSOLE_STORE_BACKEND=POSTGRES",
  "DATABASE_URL=postgresql://apiconsole:" + pg + "@127.0.0.1:15432/api_console?schema=public",
  "REDIS_URL=redis://127.0.0.1:16379",
  "POSTGRES_PUBLISH_PORT=15432",
  "REDIS_PUBLISH_PORT=16379",
  "API_CONSOLE_DATA_DIR=/app/runtime/api-console",
  "API_CONSOLE_VAULT_PROVIDER=local",
  "",
  "API_CONSOLE_CSRF_SECRET=" + secret(),
  "API_CONSOLE_SECRET_KEY=" + secret(),
  "CDE_SESSION_ENCRYPTION_KEY=" + secret(),
  "RUNTIME_SESSION_ENCRYPTION_KEY=" + secret(),
  "",
  "API_CONSOLE_ADMIN_LOGINS=09022849799",
  "API_CONSOLE_QA_LEAD_LOGINS=",
  "API_CONSOLE_REQUIRED_WORKSPACES=medu-ai",
  "API_CONSOLE_WORKSPACE_ALLOWLIST_MODE=GATE_ONLY",
  "API_CONSOLE_ALLOW_LEGACY_CONTEXT=",
  "API_CONSOLE_SESSION_TTL_SECONDS=43200",
  "API_CONSOLE_CDE_SSO_MODE=COOKIE_FORWARD",
  "API_CONSOLE_CDE_SSO_COOKIE_NAMES=*",
  "",
  "CDE_CORE_BASE_URL=https://cde.edus.ir",
  "CDE_SESSION_TTL_SECONDS=43200",
  "CDE_SESSION_REDIS_PREFIX=api-console:cde-session:",
  "",
  "RUNTIME_DEFAULT_ORIGINS=https://soha.m.edus.ir",
  "RUNTIME_ORIGIN_ALLOWLIST=*.m.edus.ir,*.medu.ir",
  "RUNTIME_SESSION_TTL_SECONDS=7200",
  "RUNTIME_SESSION_REDIS_PREFIX=api-console:runtime-session:",
  "RUNTIME_MAX_BODY_BYTES=33554432",
  "RUNTIME_REQUEST_TIMEOUT_MS=60000",
  "",
  "API_CONSOLE_DNS_SERVERS=8.8.8.8,1.1.1.1",
  "API_CONSOLE_DUAL_APPROVAL=false",
  "API_CONSOLE_SECRET_SCAN_MODE=warn",
  "API_CONSOLE_ZONE_WORKER=false",
  "",
  "API_CONSOLE_IS_ENABLED=false",
  "",
];
fs.writeFileSync(out, lines.join("\n"), "utf8");
console.log("Wrote", out);
