import Link from "next/link";

export interface SectionLink {
  href: string;
  label: string;
  current: boolean;
}

/**
 * Selector de apartado dentro de una sección del menú (D-046): p. ej.
 * «Ingredientes · Todos los locales · Centro» en Inventario. Solo navegación:
 * cada página comprueba sus permisos en el servidor.
 */
export function SectionSwitch({ label, links }: { label: string; links: SectionLink[] }) {
  if (links.length < 2) return null;
  return (
    <nav className="section-switch" aria-label={label}>
      {links.map((l) => (
        <Link key={l.href} href={l.href} aria-current={l.current ? "page" : undefined}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
