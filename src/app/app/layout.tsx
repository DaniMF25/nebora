import Link from "next/link";
import { requireUser } from "@/server/auth/current-user";
import { logoutAction } from "../login/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <main>
      <header className="top">
        <Link href="/app">
          <strong>Nébora</strong>
        </Link>
        <form action={logoutAction}>
          <span className="muted">{user.displayName} · </span>
          <button type="submit" className="link">
            Cerrar sesión
          </button>
        </form>
      </header>
      {children}
    </main>
  );
}
