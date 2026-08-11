import { createClient } from "@supabase/supabase-js";
import { createFileStorage } from "./session-store.js";

const SYNTH_EMAIL_DOMAIN = "@klimat.local";

export function normalizeLoginId(value) {
  const login = String(value || "").trim().toLowerCase();
  return login.includes("@") ? login : `${login}${SYNTH_EMAIL_DOMAIN}`;
}

export function createStdioSupabase(config) {
  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      storage: createFileStorage(config.sessionFile),
      storageKey: "kp-mcp-auth",
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
}

export function createHttpSupabase(config, accessToken) {
  if (!accessToken) throw new Error("Отсутствует Supabase access token");
  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export async function requireIdentity(client, accessToken) {
  const { data, error } = accessToken
    ? await client.auth.getUser(accessToken)
    : await client.auth.getUser();
  if (error || !data?.user?.id) {
    throw new Error("Supabase-сессия недействительна. Выполните npm run login для stdio или передайте свежий Bearer JWT");
  }
  const profileResponse = await client.from("profiles").select("approved").eq("id", data.user.id).maybeSingle();
  if (profileResponse.error || !profileResponse.data?.approved) {
    throw new Error("Аккаунт MCP не одобрен администратором или профиль недоступен");
  }
  return { id: data.user.id, email: data.user.email || "" };
}

function decodeJwtPayload(token) {
  try {
    const part = String(token || "").split(".")[1];
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch {
    throw new Error("OAuth JWT имеет неверный формат");
  }
}

export async function requireOAuthIdentity(client, accessToken, config) {
  const identity = await requireIdentity(client, accessToken);
  const claims = decodeJwtPayload(accessToken);
  if (claims.iss !== config.oauthIssuer) throw new Error("OAuth issuer не соответствует КЛИМАТ-ПРО");
  if (!claims.client_id) throw new Error("OAuth client_id отсутствует: обычная web-сессия не принимается MCP");

  const { data, error } = await client.from("mcp_user_access")
    .select("access_level")
    .eq("user_id", identity.id)
    .maybeSingle();
  if (error) throw new Error(`Не удалось проверить MCP-грант: ${error.message || error}`);
  if (!data || !["read", "write"].includes(data.access_level)) {
    throw new Error("MCP-доступ не выдан администратором или уже отозван");
  }
  return { ...identity, accessLevel: data.access_level, clientId: claims.client_id };
}
