import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHttpSupabase, createStdioSupabase, requireIdentity } from "./auth.js";
import { createChangeStore } from "./change-store.js";
import { loadConfig } from "./config.js";
import { createKlimatService } from "./service.js";
import { createSupabaseGateway } from "./supabase-gateway.js";

export const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function loadRuntimeConfig() {
  return loadConfig({ cwd: packageRoot });
}

export function createStdioService(config, changeStore = createChangeStore()) {
  const client = createStdioSupabase(config);
  const gateway = createSupabaseGateway(client);
  return createKlimatService({
    gateway,
    changeStore,
    getIdentity: () => requireIdentity(client),
  });
}

export async function createHttpService(config, accessToken, changeStore) {
  const client = createHttpSupabase(config, accessToken);
  const identity = await requireIdentity(client, accessToken);
  const gateway = createSupabaseGateway(client);
  return createKlimatService({ gateway, changeStore, getIdentity: async () => identity });
}
