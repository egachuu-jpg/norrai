import type { Env, Props } from "./types";
import { callExecutor } from "./executor";
import { jwtVerify, createRemoteJWKSet, type JWTVerifyGetKey } from "jose";

const ACCESS_JWT_HEADER = "cf-access-jwt-assertion";

// A jose key-resolving function — the common callable type satisfied by both
// createRemoteJWKSet and createLocalJWKSet. Injectable so the verification
// core is unit-testable offline (tests pass a local JWKS; production passes
// the remote one).
type JWKSResolver = JWTVerifyGetKey;

// Module-level cache of the remote JWKS: keys are fetched once and reused
// across requests (and refreshed by jose on kid rotation).
let remoteKeySet: JWKSResolver | null = null;

function getRemoteKeySet(env: Env): JWKSResolver {
  if (!remoteKeySet) {
    remoteKeySet = createRemoteJWKSet(
      new URL(`https://${env.CF_ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`),
    );
  }
  return remoteKeySet;
}

// Verification core. Reads the Cloudflare Access JWT, cryptographically
// verifies signature + issuer + audience against the supplied key set, and
// returns the `email` claim. Fails closed: ANY problem (missing header, bad
// signature, wrong aud/iss, expired, missing/invalid email claim) → null.
// Never throws.
export async function verifyAccessEmail(
  request: Request,
  env: Env,
  keySet: JWKSResolver,
): Promise<string | null> {
  const token = request.headers.get(ACCESS_JWT_HEADER);
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, keySet, {
      issuer: `https://${env.CF_ACCESS_TEAM_DOMAIN}`,
      audience: env.CF_ACCESS_AUD,
    });
    const email = payload.email;
    return typeof email === "string" && email.length > 0 ? email : null;
  } catch {
    return null;
  }
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
  const email = await verifyAccessEmail(request, env, getRemoteKeySet(env));
  if (!email) return new Response("Access JWT required or invalid", { status: 401 });

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
