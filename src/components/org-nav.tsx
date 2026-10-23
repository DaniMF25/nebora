"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface Item {
  href: string;
  label: string;
}

/** Navegación del panel de una organización; marca la sección actual. */
export function OrgNav({ items }: { items: Item[] }) {
  const pathname = usePathname();
  // La portada solo está activa en su ruta exacta; el resto, también en sus subpáginas.
  const isCurrent = (href: string, i: number) =>
    i === 0 ? pathname === href || pathname.startsWith(`${href}/establishments`) : pathname.startsWith(href);
  return (
    <nav className="org-nav" aria-label="Secciones de la organización">
      {items.map((item, i) => (
        <Link key={item.href} href={item.href} aria-current={isCurrent(item.href, i) ? "page" : undefined}>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
