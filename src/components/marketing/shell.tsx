import Link from "next/link";
import styles from "./marketing.module.css";

/** A dónde lleva la llamada principal: la prueba, el panel o (sin registro) el acceso. */
export interface MarketingAccess {
  loggedIn: boolean;
  signupEnabled: boolean;
}

export function primaryCta(access: MarketingAccess): { href: string; label: string } | null {
  if (access.loggedIn) return { href: "/app", label: "Ir al panel" };
  if (access.signupEnabled) return { href: "/register", label: "Prueba gratis 7 días" };
  return null;
}

export function Brand() {
  return (
    <Link href="/" className={styles.brand}>
      <span className={styles.brandMark} aria-hidden="true">
        N
      </span>
      <span>Nébora</span>
    </Link>
  );
}

/** Estructura de la web pública de Nébora (D-063): cabecera, contenido y pie. */
export function MarketingShell({
  access,
  current,
  children,
}: {
  access: MarketingAccess;
  current: "home" | "pricing";
  children: React.ReactNode;
}) {
  const cta = primaryCta(access);
  return (
    <div className={styles.page}>
      <a href="#contenido" className="skip-link">
        Saltar al contenido
      </a>
      <header className={styles.header}>
        <div className={`${styles.wrap} ${styles.headerInner}`}>
          <Brand />
          <nav className={styles.nav} aria-label="Principal">
            <Link href="/#funciones">Funciones</Link>
            <Link href="/precios" aria-current={current === "pricing" ? "page" : undefined}>
              Precios
            </Link>
            <Link href="/#preguntas">Preguntas</Link>
          </nav>
          <div className={styles.headerActions}>
            {!access.loggedIn && (
              <Link href="/login" className={styles.login}>
                Iniciar sesión
              </Link>
            )}
            {cta && (
              <Link href={cta.href} className={`${styles.cta} ${styles.ctaSmall}`}>
                {cta.label}
              </Link>
            )}
          </div>
        </div>
      </header>
      <main id="contenido" tabIndex={-1}>
        {children}
      </main>
      <footer className={styles.footer}>
        <div className={`${styles.wrap} ${styles.footerInner}`}>
          <Brand />
          <nav aria-label="Pie de página">
            <Link href="/#funciones">Funciones</Link>
            <Link href="/precios">Precios</Link>
            <Link href="/#preguntas">Preguntas frecuentes</Link>
            {access.loggedIn ? <Link href="/app">Ir al panel</Link> : <Link href="/login">Iniciar sesión</Link>}
          </nav>
          <span>© {new Date().getFullYear()} Nébora</span>
        </div>
      </footer>
    </div>
  );
}
