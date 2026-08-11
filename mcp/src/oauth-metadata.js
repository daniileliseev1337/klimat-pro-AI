export const MCP_OAUTH_SCOPES = ["openid", "email", "profile", "offline_access"];

export function protectedResourceMetadata(config) {
  return {
    resource: config.publicMcpUrl,
    authorization_servers: [config.oauthIssuer],
    bearer_methods_supported: ["header"],
    scopes_supported: MCP_OAUTH_SCOPES,
  };
}

export function protectedResourceMetadataUrl(config) {
  return `${new URL(config.publicMcpUrl).origin}/.well-known/oauth-protected-resource`;
}
