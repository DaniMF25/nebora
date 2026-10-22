import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { getCurrentUser } from "@/server/auth/current-user";
import { getEnv } from "@/server/config/env";
import { loginAction } from "./actions";

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/app");
  const signupEnabled = getEnv().AUTH_ALLOW_SIGNUP === "true";
  return (
    <main>
      <h1>Nébora</h1>
      <h2>Iniciar sesión</h2>
      <ActionForm action={loginAction} submitLabel="Entrar">
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
          ¿No tienes cuenta? <Link href="/register">Crear una cuenta</Link>
        </p>
      )}
    </main>
  );
}
