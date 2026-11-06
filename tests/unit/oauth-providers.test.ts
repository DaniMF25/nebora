import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import {
  authorizationUrl,
  enabledProviders,
  OAuthError,
  pkceChallenge,
  redirectUri,
  verifyIdToken,
} from "@/server/auth/oauth/providers";
import { sameState } from "@/server/auth/oauth/service";
import { parseEnv, type Env } from "@/server/config/env";

const base = { DATABASE_URL: "postgres://x/y", APP_BASE_URL: "https://app.example.test" };
const env = (extra: Record<string, string>): Env => parseEnv({ ...base, ...extra });
const full = env({
  GOOGLE_CLIENT_ID: "google-client",
  GOOGLE_CLIENT_SECRET: "g-secret",
  FACEBOOK_APP_ID: "123456789",
  FACEBOOK_APP_SECRET: "fb-secret",
  APPLE_CLIENT_ID: "com.example.web",
  APPLE_TEAM_ID: "ABCDE12345",
  APPLE_KEY_ID: "KEY1234567",
  APPLE_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\nx\\n-----END PRIVATE KEY-----",
});

// Inicio de sesión con Google, Apple y Facebook (D-061).
describe("proveedores de acceso", () => {
  it("solo se activan con todas sus credenciales y APP_BASE_URL", () => {
    expect(enabledProviders(env({}))).toEqual([]);
    expect(enabledProviders(env({ GOOGLE_CLIENT_ID: "x" }))).toEqual([]);
    expect(enabledProviders(full)).toEqual(["google", "apple", "facebook"]);
    expect(enabledProviders(parseEnv({ DATABASE_URL: "postgres://x/y", GOOGLE_CLIENT_ID: "a", GOOGLE_CLIENT_SECRET: "b" }))).toEqual([]);
    // La clave de Apple admite saltos de línea escritos como \n.
    expect(full.APPLE_PRIVATE_KEY).toContain("\nx\n");
  });

  it("la dirección del proveedor lleva state, nonce, PKCE y la vuelta exacta", async () => {
    const req = { state: "s".repeat(43), codeVerifier: "v".repeat(43), nonce: "n".repeat(43) };
    const google = await authorizationUrl("google", req, full);
    expect(google.origin).toBe("https://accounts.google.com");
    expect(google.searchParams.get("redirect_uri")).toBe("https://app.example.test/auth/google/callback");
    expect(google.searchParams.get("state")).toBe(req.state);
    expect(google.searchParams.get("nonce")).toBe(req.nonce);
    expect(google.searchParams.get("code_challenge")).toBe(await pkceChallenge(req.codeVerifier));
    expect(google.searchParams.get("code_challenge_method")).toBe("S256");
    expect(google.searchParams.get("scope")).toBe("openid email profile");
    const apple = await authorizationUrl("apple", req, full);
    expect(apple.searchParams.get("response_mode")).toBe("form_post");
    expect(apple.searchParams.get("nonce")).toBe(req.nonce);
    const facebook = await authorizationUrl("facebook", req, full);
    expect(facebook.pathname).toBe("/v23.0/dialog/oauth");
    expect(facebook.searchParams.get("scope")).toBe("public_profile,email");
    expect(redirectUri("apple", full)).toBe("https://app.example.test/auth/apple/callback");
    // PKCE S256 del ejemplo de la RFC 7636.
    expect(await pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("compara el state sin atajos y rechaza vacíos", () => {
    expect(sameState("abc", "abc")).toBe(true);
    expect(sameState("abc", "abd")).toBe(false);
    expect(sameState("abc", "abcd")).toBe(false);
    expect(sameState("", "")).toBe(false);
    expect(sameState(null, "abc")).toBe(false);
  });

  describe("token de identidad (Google y Apple)", () => {
    let keys: ReturnType<typeof createLocalJWKSet>;
    let sign: (claims: Record<string, unknown>, options?: { iss?: string; aud?: string; exp?: string }) => Promise<string>;
    let otherSign: typeof sign;

    beforeAll(async () => {
      const mine = await generateKeyPair("RS256");
      const other = await generateKeyPair("RS256");
      keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(mine.publicKey)), kid: "k1", alg: "RS256" }] });
      const make = (key: CryptoKey) => (claims: Record<string, unknown>, o: { iss?: string; aud?: string; exp?: string } = {}) =>
        new SignJWT(claims)
          .setProtectedHeader({ alg: "RS256", kid: "k1" })
          .setIssuer(o.iss ?? "https://accounts.google.com")
          .setAudience(o.aud ?? "google-client")
          .setSubject("1234567890")
          .setIssuedAt()
          .setExpirationTime(o.exp ?? "5m")
          .sign(key);
      sign = make(mine.privateKey);
      otherSign = make(other.privateKey);
    });

    it("acepta uno válido y extrae identidad, correo verificado y nombre", async () => {
      const token = await sign({ nonce: "n1", email: "Ana@Example.test", email_verified: true, name: "Ana" });
      expect(await verifyIdToken("google", token, "n1", full, keys)).toEqual({
        provider: "google",
        subject: "1234567890",
        email: "ana@example.test",
        emailVerified: true,
        name: "Ana",
      });
      // Apple envía email_verified como cadena.
      const apple = await sign(
        { nonce: "n1", email: "a@example.test", email_verified: "true" },
        { iss: "https://appleid.apple.com", aud: "com.example.web" },
      );
      expect((await verifyIdToken("apple", apple, "n1", full, keys)).emailVerified).toBe(true);
    });

    it("rechaza firma ajena, otro destinatario u emisor, caducado, otro nonce y correo sin verificar como verificado", async () => {
      const bad = async (token: Promise<string>, nonce = "n1") =>
        expect(verifyIdToken("google", await token, nonce, full, keys)).rejects.toBeInstanceOf(OAuthError);
      await bad(otherSign({ nonce: "n1" }));
      await bad(sign({ nonce: "n1" }, { aud: "otra-app" }));
      await bad(sign({ nonce: "n1" }, { iss: "https://evil.example" }));
      await bad(sign({ nonce: "n1" }, { exp: "-10m" }));
      await bad(sign({ nonce: "otro" }));
      await bad(Promise.resolve("no-es-un-jwt"));
      const unverified = await sign({ nonce: "n1", email: "a@example.test", email_verified: false });
      expect((await verifyIdToken("google", unverified, "n1", full, keys)).emailVerified).toBe(false);
    });
  });
});
