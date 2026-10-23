import Link from "next/link";

export interface PageTab {
  id: string;
  label: string;
}

/**
 * Pestañas de una página del panel como enlaces (`?tab=`): funcionan sin
 * JavaScript, se pueden compartir y el navegador recuerda la pestaña. La
 * primera es la predeterminada.
 */
export function PageTabs({ tabs, current, basePath }: { tabs: PageTab[]; current: string; basePath: string }) {
  return (
    <nav className="page-tabs" aria-label="Apartados de la página">
      {tabs.map((t, i) => (
        <Link key={t.id} href={i === 0 ? basePath : `${basePath}?tab=${t.id}`} aria-current={t.id === current ? "page" : undefined}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

/** Pestaña pedida si es válida; si no, la primera. */
export function pickTab<T extends string>(requested: string | string[] | undefined, ids: readonly T[]): T {
  const value = Array.isArray(requested) ? requested[0] : requested;
  return ids.includes(value as T) ? (value as T) : ids[0]!;
}
