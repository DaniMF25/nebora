import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { getCurrentUser } from "@/server/auth/current-user";
import { getEnv } from "@/server/config/env";
import { PASSWORD_MIN_LENGTH } from "@/server/auth/password";
import { registerAction } from "./actions";

export default async function RegisterPage() {
  if (await getCurrentUser()) redirect("/app");
  if (getEnv().AUTH_ALLOW_SIGNUP !== "true") {
    return (
      <main>
        <h1>Registro no disponible</h1>
        <p className="muted">El alta de cuentas no está habilitada en este entorno.</p>
        <Link href="/login">Volver</Link>
      </main>
    );
  }
  return (
    <main>
      <h1>Crear cuenta</h1>
      <ActionForm action={registerAction} submitLabel="Crear cuenta">
        <label>
          Nombre
          <input name="displayName" autoComplete="name" required maxLength={120} />
        </label>
        <label>
          Correo electrónico
          <input name="email" type="email" autoComplete="email" required />
        </label>
        <label>
          Contraseña (mínimo {PASSWORD_MIN_LENGTH} caracteres)
          <input name="password" type="password" autoComplete="new-password" required minLength={PASSWORD_MIN_LENGTH} />
        </label>
      </ActionForm>
      <p className="muted">
        ¿Ya tienes cuenta? <Link href="/login">Iniciar sesión</Link>
      </p>
    </main>
  );
}
