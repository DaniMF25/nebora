import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { getCurrentUser } from "@/server/auth/current-user";
import { PASSWORD_MIN_LENGTH } from "@/server/auth/password";
import { withTransaction } from "@/server/db/pool";
import { getInvitationPreview } from "@/server/modules/members/service";
import { acceptInvitationAction, registerWithInvitationAction } from "./actions";

// El token va en la URL: que no se indexe ni se envíe como Referer a terceros.
export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

const ROLE_LABELS = { owner: "propietario", admin: "administrador", manager: "encargado", staff: "personal" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [user, preview] = await Promise.all([
    getCurrentUser(),
    withTransaction((tx) => getInvitationPreview(tx, token)),
  ]);

  if (!preview || preview.status !== "pending") {
    return (
      <main>
        <h1>Invitación no válida</h1>
        <p className="muted">La invitación no existe, ha caducado, fue revocada o ya se utilizó.</p>
        <Link href="/login">Ir al inicio de sesión</Link>
      </main>
    );
  }

  const intro = (
    <p>
      Te han invitado a <strong>{preview.organizationName}</strong> como {ROLE_LABELS[preview.role]}. La
      invitación es para <strong>{preview.email}</strong>.
    </p>
  );

  if (user) {
    const sameEmail = user.email.toLowerCase() === preview.email.toLowerCase();
    return (
      <main>
        <h1>Invitación</h1>
        {intro}
        {sameEmail ? (
          <ActionForm action={acceptInvitationAction.bind(null, token)} submitLabel="Aceptar invitación" />
        ) : (
          <p className="alert">
            Has iniciado sesión como {user.email}. Cierra sesión y entra con {preview.email} para aceptarla.
          </p>
        )}
      </main>
    );
  }

  return (
    <main>
      <h1>Invitación</h1>
      {intro}
      <p>
        ¿Ya tienes cuenta con ese correo?{" "}
        <Link href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}>Inicia sesión para aceptarla</Link>.
      </p>
      <section>
        <h2>Crear cuenta y aceptar</h2>
        <ActionForm action={registerWithInvitationAction.bind(null, token)} submitLabel="Crear cuenta y unirme">
          <label>
            Nombre
            <input name="displayName" autoComplete="name" required maxLength={120} />
          </label>
          <label>
            Contraseña (mínimo {PASSWORD_MIN_LENGTH} caracteres)
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={PASSWORD_MIN_LENGTH}
            />
          </label>
        </ActionForm>
      </section>
    </main>
  );
}
