import Link from "next/link";
import { marketing, marketingmono } from "@/fonts/marketing";
import styles from "./marketing.module.css";

/** A dónde lleva la llamada principal: la prueba, el panel o (sin registro) el acceso. */
export interface MarketingAccess {
  loggedIn: boolean;
  signupEnabled: boolean;
}

export function primaryCta(access: MarketingAccess): { href: string; label: string } | null {
  if (access.loggedIn) return { href: "/app", label: "Ir al panel" };
  if (access.signupEnabled) return { href: "/register", label: "Prueba 7 días" };
  return null;
}

/** Estructura de la web pública de Nébora (D-063, D-065): cabecera, contenido y pie. */
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
    <div className={`${styles.page} ${marketing.variable} ${marketingmono.variable}`}>
      <a href="#contenido" className="skip-link">
        Saltar al contenido
      </a>
      <header className={styles.header}>
        <div className={`${styles.wrap} ${styles.headerInner}`}>
          <Link href="/" className={styles.brand}>
            nébora
          </Link>
          <nav className={styles.nav} aria-label="Principal">
            <Link href="/#sala">Sala</Link>
            <Link href="/#cocina">Cocina</Link>
            <Link href="/#carta">Carta y web</Link>
            <Link href="/precios" aria-current={current === "pricing" ? "page" : undefined}>
              Precios
            </Link>
          </nav>
          <div className={styles.headerActions}>
            {!access.loggedIn && (
              <Link href="/login" className={styles.login}>
                Iniciar sesión
              </Link>
            )}
            {cta && (
              <Link href={cta.href} className={styles.ctaSmall}>
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
        <div className={styles.wrap}>
          <p className={styles.footerWord} aria-hidden="true">
            nébora
          </p>
          <div className={styles.footerInner}>
            <span>© {new Date().getFullYear()} Nébora · Software para restaurantes</span>
            <nav aria-label="Pie de página">
              <Link href="/precios">Precios</Link>
              <Link href="/#preguntas">Preguntas</Link>
              {access.loggedIn ? <Link href="/app">Ir al panel</Link> : <Link href="/login">Iniciar sesión</Link>}
            </nav>
          </div>
        </div>
      </footer>
    </div>
  );
}
