import { describe, it, expect, beforeAll } from "vitest";
import {
  generateKeyPair,
  exportJWK,
  SignJWT,
  createLocalJWKSet,
  type JWK,
  type CryptoKey,
} from "jose";
import { verifyAccessEmail } from "../src/access";
import type { Env } from "../src/types";

const TEAM_DOMAIN = "norrai.cloudflareaccess.com";
const ISSUER = `https://${TEAM_DOMAIN}`;
const AUD = "test-access-aud-tag";

const env = {
  CF_ACCESS_TEAM_DOMAIN: TEAM_DOMAIN,
  CF_ACCESS_AUD: AUD,
} as unknown as Env;

// Signing keys in the key set.
let goodPrivate: CryptoKey;
// A separate key pair NOT in the key set, used to forge a bad signature.
let roguePrivate: CryptoKey;
// Local (offline) JWKS containing only the good public key.
let keySet: ReturnType<typeof createLocalJWKSet>;

function requestWithToken(token: string | null): Request {
  const headers = new Headers();
  if (token !== null) headers.set("cf-access-jwt-assertion", token);
  return new Request("https://mcp.norrai.co/authorize", { headers });
}

async function signToken(
  signer: CryptoKey,
  claims: Record<string, unknown>,
  opts: { iss?: string; aud?: string; exp?: string | number } = {},
): Promise<string> {
  const jwt = new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "test-kid" })
    .setIssuer(opts.iss ?? ISSUER)
    .setAudience(opts.aud ?? AUD)
    .setIssuedAt();
  jwt.setExpirationTime(opts.exp ?? "1h");
  return jwt.sign(signer);
}

beforeAll(async () => {
  const good = await generateKeyPair("RS256");
  const rogue = await generateKeyPair("RS256");
  goodPrivate = good.privateKey;
  roguePrivate = rogue.privateKey;

  const jwk = (await exportJWK(good.publicKey)) as JWK;
  jwk.kid = "test-kid";
  jwk.alg = "RS256";
  jwk.use = "sig";
  keySet = createLocalJWKSet({ keys: [jwk] });
});

describe("verifyAccessEmail", () => {
  it("returns the email for a valid token (correct iss, aud, email)", async () => {
    const token = await signToken(goodPrivate, { email: "agent@norrai.co" });
    const email = await verifyAccessEmail(requestWithToken(token), env, keySet);
    expect(email).toBe("agent@norrai.co");
  });

  it("returns null for the wrong audience", async () => {
    const token = await signToken(goodPrivate, { email: "agent@norrai.co" }, { aud: "some-other-aud" });
    const email = await verifyAccessEmail(requestWithToken(token), env, keySet);
    expect(email).toBeNull();
  });

  it("returns null for a bad signature (key not in the set)", async () => {
    const token = await signToken(roguePrivate, { email: "agent@norrai.co" });
    const email = await verifyAccessEmail(requestWithToken(token), env, keySet);
    expect(email).toBeNull();
  });

  it("returns null when the cf-access-jwt-assertion header is missing", async () => {
    const email = await verifyAccessEmail(requestWithToken(null), env, keySet);
    expect(email).toBeNull();
  });

  it("returns null for an expired token", async () => {
    // Issued and expired in the past.
    const token = await new SignJWT({ email: "agent@norrai.co" })
      .setProtectedHeader({ alg: "RS256", kid: "test-kid" })
      .setIssuer(ISSUER)
      .setAudience(AUD)
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(goodPrivate);
    const email = await verifyAccessEmail(requestWithToken(token), env, keySet);
    expect(email).toBeNull();
  });

  it("returns null for the wrong issuer", async () => {
    const token = await signToken(goodPrivate, { email: "agent@norrai.co" }, { iss: "https://evil.cloudflareaccess.com" });
    const email = await verifyAccessEmail(requestWithToken(token), env, keySet);
    expect(email).toBeNull();
  });

  it("returns null when the email claim is missing", async () => {
    const token = await signToken(goodPrivate, { sub: "no-email-here" });
    const email = await verifyAccessEmail(requestWithToken(token), env, keySet);
    expect(email).toBeNull();
  });
});
