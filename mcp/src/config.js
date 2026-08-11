import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

function parseEnvFile(file) {
  if (!file || !existsSync(file)) return {};
  const values = {};
  for (const rawLine of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

function csv(value, fallback = []) {
  if (!value) return fallback;
  return String(value).split(",").map(v => v.trim()).filter(Boolean);
}

export function loadConfig({ env = process.env, cwd = process.cwd() } = {}) {
  const defaultEnvFile = path.resolve(cwd, "..", ".env.production");
  const fileEnv = parseEnvFile(env.KP_ENV_FILE || defaultEnvFile);
  const values = { ...fileEnv, ...env };

  const forbidden = Object.entries(values).find(([key, value]) => /service[_-]?role/i.test(key) && value);
  if (forbidden) {
    throw new Error("MCP запрещает service_role: используйте только anon key и пользовательскую Supabase-сессию");
  }

  const supabaseUrl = values.KP_SUPABASE_URL || values.VITE_SUPABASE_URL;
  const supabaseAnonKey = values.KP_SUPABASE_ANON_KEY || values.VITE_SUPABASE_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Задайте KP_SUPABASE_URL и KP_SUPABASE_ANON_KEY (или VITE_SUPABASE_URL/VITE_SUPABASE_KEY)");
  }

  const httpHost = values.KP_HTTP_HOST || "127.0.0.1";
  const httpPort = Number(values.KP_HTTP_PORT || 8788);
  if (!Number.isInteger(httpPort) || httpPort < 1 || httpPort > 65535) {
    throw new Error("KP_HTTP_PORT должен быть целым числом от 1 до 65535");
  }
  const requestedBodyLimit = Number(values.KP_HTTP_BODY_LIMIT || 1_000_000);
  if (!Number.isFinite(requestedBodyLimit) || requestedBodyLimit <= 0) {
    throw new Error("KP_HTTP_BODY_LIMIT должен быть положительным числом байт");
  }

  const publicMcpUrl = String(values.KP_PUBLIC_MCP_URL || `${supabaseUrl.replace(/\/$/, "")}/mcp`).replace(/\/$/, "");
  let publicOrigin;
  try { publicOrigin = new URL(publicMcpUrl).origin; }
  catch { throw new Error("KP_PUBLIC_MCP_URL должен быть абсолютным HTTPS URL"); }
  if (values.KP_PUBLIC_MCP_URL && !publicMcpUrl.startsWith("https://")) {
    throw new Error("KP_PUBLIC_MCP_URL в production должен использовать HTTPS");
  }

  return {
    supabaseUrl: String(supabaseUrl).replace(/\/$/, ""),
    supabaseAnonKey: String(supabaseAnonKey),
    sessionFile: path.resolve(values.KP_SESSION_FILE || path.join(cwd, ".local", "session.json")),
    httpHost,
    httpPort,
    allowedHosts: csv(values.KP_ALLOWED_HOSTS, [httpHost, `${httpHost}:${httpPort}`, "localhost", `localhost:${httpPort}`]),
    allowedOrigins: csv(values.KP_ALLOWED_ORIGINS),
    bodyLimitBytes: Math.min(2_000_000, Math.max(16_384, requestedBodyLimit)),
    publicMcpUrl,
    oauthIssuer: String(values.KP_OAUTH_ISSUER || `${publicOrigin}/auth/v1`).replace(/\/$/, ""),
  };
}
