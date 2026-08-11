import { createHash, randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createClient } from "@supabase/supabase-js";

const required = name => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};

const base = required("KP_E2E_BASE_URL").replace(/\/$/, "");
const anonKey = required("KP_E2E_ANON_KEY");
const email = required("KP_E2E_EMAIL");
const password = required("KP_E2E_PASSWORD");
const clientName = required("KP_E2E_CLIENT_NAME");
const redirectUri = "http://127.0.0.1:17878/oauth/callback";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function json(response, label) {
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${label}: HTTP ${response.status} ${JSON.stringify(body)}`);
  return body;
}

function jwtPayload(token) {
  return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
}

async function connectMcp(accessToken, suffix) {
  const client = new Client({ name: `klimat-live-e2e-${suffix}`, version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  await client.connect(transport);
  return client;
}

async function setAccess(supabase, userId, level) {
  const { error } = await supabase.rpc("admin_set_mcp_access", {
    p_user_id: userId,
    p_access_level: level,
  });
  if (error) throw error;
}

const dcr = await json(await fetch(`${base}/auth/v1/oauth/clients/register`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    client_name: clientName,
    redirect_uris: [redirectUri],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  }),
}), "DCR");
assert(dcr.client_id, "DCR did not return client_id");

const verifier = randomBytes(48).toString("base64url");
const challenge = createHash("sha256").update(verifier).digest("base64url");
const state = randomBytes(18).toString("base64url");
const authorizeUrl = new URL(`${base}/auth/v1/oauth/authorize`);
authorizeUrl.search = new URLSearchParams({
  client_id: dcr.client_id,
  redirect_uri: redirectUri,
  response_type: "code",
  code_challenge: challenge,
  code_challenge_method: "S256",
  scope: "openid email profile offline_access",
  state,
}).toString();

const authorizationStart = await fetch(authorizeUrl, { redirect: "manual" });
assert([302, 303].includes(authorizationStart.status), `authorize returned ${authorizationStart.status}`);
const consentUrl = new URL(authorizationStart.headers.get("location"));
assert(consentUrl.origin === base && consentUrl.pathname === "/oauth/consent", "unexpected consent URL");
const authorizationId = consentUrl.searchParams.get("authorization_id");
assert(authorizationId, "authorization_id is missing");

const supabase = createClient(base, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
const signIn = await supabase.auth.signInWithPassword({ email, password });
if (signIn.error) throw signIn.error;
const userId = signIn.data.user?.id;
assert(userId, "temporary user login failed");

const details = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
if (details.error) throw details.error;
assert(details.data?.client?.name === clientName, "consent client name mismatch");

const approval = await supabase.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true });
if (approval.error) throw approval.error;
const callbackUrl = new URL(approval.data.redirect_url);
assert(callbackUrl.searchParams.get("state") === state, "OAuth state mismatch");
const code = callbackUrl.searchParams.get("code");
assert(code, "authorization code is missing");

const token = await json(await fetch(`${base}/auth/v1/oauth/token`, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "authorization_code",
    client_id: dcr.client_id,
    redirect_uri: redirectUri,
    code,
    code_verifier: verifier,
  }),
}), "token exchange");
assert(token.access_token && token.refresh_token, "OAuth access/refresh token missing");
const claims = jwtPayload(token.access_token);
assert(claims.iss === `${base}/auth/v1`, "OAuth issuer mismatch");
assert(claims.client_id === dcr.client_id, "OAuth client_id claim mismatch");

const readClient = await connectMcp(token.access_token, "read");
const tools = await readClient.listTools();
assert(tools.tools.length === 5, `expected 5 tools, got ${tools.tools.length}`);
const context = await readClient.callTool({ name: "kp_get_context", arguments: {} });
assert(!context.isError && context.structuredContent?.data?.mcpAccessLevel === "read", "read context failed");
const query = await readClient.callTool({ name: "kp_query", arguments: { entity: "projects", limit: 1 } });
assert(!query.isError, "read query failed");
const denied = await readClient.callTool({
  name: "kp_prepare_change",
  arguments: { action: "client.create", payload: { name: `${clientName} record` } },
});
assert(denied.isError && denied.content?.[0]?.text?.includes("только чтение"), "read grant allowed prepare");

await setAccess(supabase, userId, "write");
const prepareCreate = await readClient.callTool({
  name: "kp_prepare_change",
  arguments: { action: "client.create", payload: { name: `${clientName} record` } },
});
assert(!prepareCreate.isError, "write prepare failed");
const createData = prepareCreate.structuredContent.data;
const confirmedCreate = await readClient.callTool({
  name: "kp_confirm_change",
  arguments: { confirmationToken: createData.confirmationToken, confirmation: createData.confirmation },
});
assert(!confirmedCreate.isError && confirmedCreate.structuredContent?.data?.id, "write confirm failed");
const recordId = confirmedCreate.structuredContent.data.id;

const prepareDelete = await readClient.callTool({
  name: "kp_prepare_change",
  arguments: { action: "client.delete", payload: { id: recordId } },
});
assert(!prepareDelete.isError, "cleanup prepare failed");
const deleteData = prepareDelete.structuredContent.data;
const confirmedDelete = await readClient.callTool({
  name: "kp_confirm_change",
  arguments: { confirmationToken: deleteData.confirmationToken, confirmation: deleteData.confirmation },
});
assert(!confirmedDelete.isError, "cleanup confirm failed");
await readClient.close();

const refreshed = await json(await fetch(`${base}/auth/v1/oauth/token`, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "refresh_token",
    client_id: dcr.client_id,
    refresh_token: token.refresh_token,
  }),
}), "refresh token");
assert(refreshed.access_token && refreshed.refresh_token, "refresh did not rotate tokens");

const refreshedClient = await connectMcp(refreshed.access_token, "refreshed");
const refreshedContext = await refreshedClient.callTool({ name: "kp_get_context", arguments: {} });
assert(!refreshedContext.isError, "refreshed access token failed");
await refreshedClient.close();

await setAccess(supabase, userId, "none");
const revokedResponse = await fetch(`${base}/mcp`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${refreshed.access_token}`,
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "klimat-live-e2e-revoked", version: "1.0.0" },
    },
  }),
});
assert(revokedResponse.status === 401, `revoked grant returned HTTP ${revokedResponse.status}`);

await supabase.auth.signOut();
process.stdout.write(JSON.stringify({
  ok: true,
  dcr: true,
  pkce: true,
  consent: true,
  refresh: true,
  readDeniedWrite: true,
  writePrepareConfirm: true,
  revokeImmediate: true,
  tools: tools.tools.length,
}) + "\n");
