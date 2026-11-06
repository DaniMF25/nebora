import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { getCurrentUser } from "@/server/auth/current-user";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { getEnv } from "@/server/config/env";
import { SocialLogin } from "@/components/auth/social-login";
import { enabledProviders } from "@/server/auth/oauth/providers";
import { isSocialLoginErrorCode, SOCIAL_LOGIN_MESSAGES } from "@/server/auth/oauth/service";
import { loginAction } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[]; error?: string | string[] }>;
}) {
  const search = await searchParams;
  const next = safeRedirectPath(search.next);
  // Error al volver de Google, Apple o Facebook (solo códigos conocidos: nunca texto del enlace).
  const socialError = isSocialLoginErrorCode(search.error) ? SOCIAL_LOGIN_MESSAGES[search.error] : null;
  if (await getCurrentUser()) redirect(next);
  const signupEnabled = getEnv().AUTH_ALLOW_SIGNUP === "true";
  return (
    <main className="auth">
      <h1>Nébora</h1>
      <h2>Iniciar sesión</h2>
      {socialError && (
        <p role="alert" className="alert">
          {socialError}
        </p>
      )}
      <SocialLogin providers={enabledProviders()} next={next === "/app" ? undefined : next} />
      <ActionForm action={loginAction} submitLabel="Entrar">
        <input type="hidden" name="next" value={next} />
        <label>
          Correo electrónico
          <input name="email" type="email" autoComplete="email" required />
        </label>
        <label>
          Contraseña
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
      </ActionForm>
      {signupEnabled && (
        <p className="muted">
          ¿No tienes cuenta? <Link href="/register">Prueba Nébora gratis</Link>
        </p>
      )}
      <p className="muted">
        <Link href="/">Conoce Nébora</Link>
      </p>
    </main>
  );
}
