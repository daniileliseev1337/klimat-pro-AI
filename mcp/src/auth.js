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
