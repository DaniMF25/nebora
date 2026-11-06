import "server-only";
import { createHmac } from "node:crypto";
import { createRemoteJWKSet, importPKCS8, jwtVerify, SignJWT, type JWTVerifyGetKey } from "jose";
import { getEnv, type Env } from "@/server/config/env";

/**
 * Proveedores de inicio de sesión (D-061): Google y Apple con OpenID Connect
 * (token de identidad firmado, comprobado con sus claves públicas) y Facebook
 * con OAuth 2.0 y la Graph API. Solo se activan con sus credenciales; sin
 * ellas no se muestran ni aceptan.
 */

export const OAUTH_PROVIDERS = ["google", "apple", "facebook"] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

export const PROVIDER_LABELS: Record<OAuthProvider, string> = {
  google: "Google",
  apple: "Apple",
  facebook: "Facebook",
};

export function isOAuthProvider(value: unknown): value is OAuthProvider {
  return typeof value === "string" && (OAUTH_PROVIDERS as readonly string[]).includes(value);
}

/** Datos de la persona que devuelve el proveedor, ya comprobados. */
export interface ProviderProfile {
  provider: OAuthProvider;
  /** Identificador estable de la persona en el proveedor. */
  subject: string;
  email: string | null;
  /** El proveedor garantiza que el correo es de esa persona. */
  emailVerified: boolean;
  name: string | null;
}

export class OAuthError extends Error {
  constructor(
    public readonly code: "provider_error" | "invalid_token" | "missing_email",
    message: string,
  ) {
    super(message);
  }
}

/** Proveedores con todas sus credenciales y APP_BASE_URL configurados. */
export function enabledProviders(env: Env = getEnv()): OAuthProvider[] {
  if (!env.APP_BASE_URL) return [];
  return OAUTH_PROVIDERS.filter((p) =>
    p === "google"
      ? Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)
      : p === "facebook"
        ? Boolean(env.FACEBOOK_APP_ID && env.FACEBOOK_APP_SECRET)
        : Boolean(env.APPLE_CLIENT_ID && env.APPLE_TEAM_ID && env.APPLE_KEY_ID && env.APPLE_PRIVATE_KEY),
  );
}

export function redirectUri(provider: OAuthProvider, env: Env = getEnv()): string {
  return `${env.APP_BASE_URL}/auth/${provider}/callback`;
}

/** Datos de un intento de inicio de sesión que se guardan (en una cookie) hasta la vuelta. */
export interface AuthorizationRequest {
  state: string;
  /** PKCE (Google). */
  codeVerifier: string;
  /** Liga el token de identidad a este intento (Google y Apple). */
  nonce: string;
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return Buffer.from(digest).toString("base64url");
}

/** Dirección del proveedor a la que se envía a la persona para que se identifique. */
export async function authorizationUrl(provider: OAuthProvider, req: AuthorizationRequest, env: Env = getEnv()) {
  const redirect = redirectUri(provider, env);
  if (provider === "google") {
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID!,
      redirect_uri: redirect,
      response_type: "code",
      scope: "openid email profile",
      state: req.state,
      nonce: req.nonce,
      code_challenge: await pkceChallenge(req.codeVerifier),
      code_challenge_method: "S256",
      prompt: "select_account",
    }).toString();
    return url;
  }
  if (provider === "apple") {
    // Con nombre y correo, Apple vuelve con un POST (form_post) desde su dominio.
    const url = new URL("https://appleid.apple.com/auth/authorize");
    url.search = new URLSearchParams({
      client_id: env.APPLE_CLIENT_ID!,
      redirect_uri: redirect,
      response_type: "code",
      response_mode: "form_post",
      scope: "name email",
      state: req.state,
      nonce: req.nonce,
    }).toString();
    return url;
  }
  const url = new URL(`https://www.facebook.com/${env.FACEBOOK_GRAPH_VERSION}/dialog/oauth`);
  url.search = new URLSearchParams({
    client_id: env.FACEBOOK_APP_ID!,
    redirect_uri: redirect,
    response_type: "code",
    scope: "public_profile,email",
    state: req.state,
  }).toString();
  return url;
}

async function postForm(url: string, body: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(10_000),
  });
  // Nunca se registra la respuesta: puede contener tokens.
  if (!res.ok) throw new OAuthError("provider_error", `El proveedor rechazó el código (${res.status})`);
  return (await res.json()) as Record<string, unknown>;
}

// Claves públicas de los proveedores (jose las guarda en caché y las renueva).
const GOOGLE_KEYS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const APPLE_KEYS = createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"));

/**
 * Comprueba un token de identidad (OpenID Connect): firma con las claves del
 * proveedor, emisor, destinatario (nuestra aplicación), caducidad y que el
 * nonce es el de este intento. `keys` solo se sustituye en las pruebas.
 */
export async function verifyIdToken(
  provider: "google" | "apple",
  idToken: unknown,
  nonce: string,
  env: Env = getEnv(),
  keys: JWTVerifyGetKey = provider === "google" ? GOOGLE_KEYS : APPLE_KEYS,
): Promise<ProviderProfile> {
  if (typeof idToken !== "string") throw new OAuthError("invalid_token", "Falta el token de identidad");
  let payload: Record<string, unknown>;
  try {
    ({ payload } = await jwtVerify(idToken, keys, {
      issuer: provider === "google" ? ["https://accounts.google.com", "accounts.google.com"] : "https://appleid.apple.com",
      audience: provider === "google" ? env.GOOGLE_CLIENT_ID! : env.APPLE_CLIENT_ID!,
      algorithms: ["RS256"],
      clockTolerance: 60,
    }));
  } catch {
    throw new OAuthError("invalid_token", "Token de identidad no válido");
  }
  if (payload.nonce !== nonce) throw new OAuthError("invalid_token", "El token no corresponde a este intento");
  if (typeof payload.sub !== "string" || payload.sub === "") throw new OAuthError("invalid_token", "Token sin identificador");
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : null;
  // Apple envía email_verified como cadena ("true") o booleano.
  const emailVerified = payload.email_verified === true || payload.email_verified === "true";
  return {
    provider,
    subject: payload.sub,
    email,
    emailVerified: Boolean(email) && emailVerified,
    name: typeof payload.name === "string" ? payload.name : null,
  };
}

/** Secreto de cliente de Apple: un JWT firmado con la clave privada de la cuenta de desarrollador. */
async function appleClientSecret(env: Env): Promise<string> {
  const key = await importPKCS8(env.APPLE_PRIVATE_KEY!, "ES256");
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: env.APPLE_KEY_ID! })
    .setIssuer(env.APPLE_TEAM_ID!)
    .setSubject(env.APPLE_CLIENT_ID!)
    .setAudience("https://appleid.apple.com")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(key);
}

/** Nombre que Apple envía solo la primera vez, en el campo `user` del formulario. */
function appleName(user: unknown): string | null {
  if (typeof user !== "string" || user.length > 2000) return null;
  try {
    const parsed = JSON.parse(user) as { name?: { firstName?: unknown; lastName?: unknown } };
    const parts = [parsed.name?.firstName, parsed.name?.lastName].filter((p): p is string => typeof p === "string");
    return parts.join(" ").trim() || null;
  } catch {
    return null;
  }
}

/**
 * Canjea el código de vuelta por los datos de la persona, comprobados con el
 * proveedor. `appleUser` es el campo `user` del POST de Apple (solo nombre).
 */
export async function exchangeCode(
  provider: OAuthProvider,
  code: string,
  req: AuthorizationRequest,
  options: { appleUser?: unknown } = {},
  env: Env = getEnv(),
): Promise<ProviderProfile> {
  const redirect = redirectUri(provider, env);
  if (provider === "google") {
    const tokens = await postForm("https://oauth2.googleapis.com/token", {
      grant_type: "authorization_code",
      code,
      redirect_uri: redirect,
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      code_verifier: req.codeVerifier,
    });
    return verifyIdToken("google", tokens.id_token, req.nonce, env);
  }
  if (provider === "apple") {
    const tokens = await postForm("https://appleid.apple.com/auth/token", {
      grant_type: "authorization_code",
      code,
      redirect_uri: redirect,
      client_id: env.APPLE_CLIENT_ID!,
      client_secret: await appleClientSecret(env),
    });
    const profile = await verifyIdToken("apple", tokens.id_token, req.nonce, env);
    return { ...profile, name: profile.name ?? appleName(options.appleUser) };
  }
  const base = `https://graph.facebook.com/${env.FACEBOOK_GRAPH_VERSION}`;
  const tokenUrl = new URL(`${base}/oauth/access_token`);
  tokenUrl.search = new URLSearchParams({
    client_id: env.FACEBOOK_APP_ID!,
    client_secret: env.FACEBOOK_APP_SECRET!,
    redirect_uri: redirect,
    code,
  }).toString();
  const tokenRes = await fetch(tokenUrl, { signal: AbortSignal.timeout(10_000) });
  if (!tokenRes.ok) throw new OAuthError("provider_error", `Facebook rechazó el código (${tokenRes.status})`);
  const { access_token: accessToken } = (await tokenRes.json()) as { access_token?: unknown };
  if (typeof accessToken !== "string") throw new OAuthError("provider_error", "Facebook no devolvió acceso");
  // appsecret_proof: la Graph API comprueba que la llamada la hace nuestro servidor.
  const proof = createHmac("sha256", env.FACEBOOK_APP_SECRET!).update(accessToken).digest("hex");
  const meUrl = new URL(`${base}/me`);
  meUrl.search = new URLSearchParams({ fields: "id,name,email", appsecret_proof: proof }).toString();
  const meRes = await fetch(meUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!meRes.ok) throw new OAuthError("provider_error", `Facebook no devolvió el perfil (${meRes.status})`);
  const me = (await meRes.json()) as { id?: unknown; name?: unknown; email?: unknown };
  if (typeof me.id !== "string" || me.id === "") throw new OAuthError("provider_error", "Perfil de Facebook sin identificador");
  return {
    provider,
    subject: me.id,
    email: typeof me.email === "string" ? me.email.trim().toLowerCase() : null,
    // Facebook no garantiza que el correo esté verificado: no sirve para vincular cuentas existentes.
    emailVerified: false,
    name: typeof me.name === "string" ? me.name : null,
  };
}
