export interface Env {
  OAUTH_KV: KVNamespace;
  OAUTH_PROVIDER: any; // helper binding injected by workers-oauth-provider
  N8N_EXECUTOR_URL: string;
  N8N_SHARED_SECRET: string;
  // Cloudflare Access JWT verification config.
  CF_ACCESS_TEAM_DOMAIN: string; // e.g. "norrai.cloudflareaccess.com"
  CF_ACCESS_AUD: string; // the Access app's Application Audience (AUD) tag
}

// Bound to the issued token; set in the /authorize handler.
export interface Props {
  email: string;
  clientId: string;
  enabledTools: string[];
  [key: string]: unknown;
}

export interface ExecutorResult {
  // tool actions return the Format Result JSON; validate_agent returns the row
  [key: string]: unknown;
}
