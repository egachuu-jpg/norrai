import type { Env, Props } from "./types";
import { callExecutor } from "./executor";

const ACCESS_EMAIL_HEADER = "cf-access-authenticated-user-email";

export function verifiedEmail(request: Request): string | null {
  return request.headers.get(ACCESS_EMAIL_HEADER);
}

// Isolated for unit testing: given an executor caller, resolve props or null.
export async function resolveAgent(
  call: typeof callExecutor,
  env: Env,
  email: string,
): Promise<Props | null> {
  const row = (await call(env, "validate_agent", email, {})) as {
    client_id?: string | null;
    enabled_tools?: string[];
  };
  if (!row?.client_id) return null;
  return { email, clientId: row.client_id, enabledTools: row.enabled_tools ?? [] };
}

// Request handler mounted at /authorize (behind Cloudflare Access).
export async function handleAuthorize(request: Request, env: Env): Promise<Response> {
  const email = verifiedEmail(request);
  if (!email) return new Response("Access authentication required", { status: 401 });

  const props = await resolveAgent(callExecutor, env, email);
  if (!props) {
    return new Response(
      "This email isn't linked to a Norr AI account. Contact hello@norrai.co.",
      { status: 403 },
    );
  }

  const oauthReq = await env.OAUTH_PROVIDER.parseAuthRequest(request);
  const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
    request: oauthReq,
    userId: email,
    scope: oauthReq.scope,
    metadata: { email },
    props,
  });
  return Response.redirect(redirectTo, 302);
}
