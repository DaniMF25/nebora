"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { PanelIcon, type PanelIconName } from "./icons";

export interface NavItem {
  href: string;
  label: string;
  icon: PanelIconName;
  /** Activo solo en la ruta exacta (la portada); el resto, también en sus subpáginas. */
  exact?: boolean;
  /** Otras rutas de la misma sección (expresión regular), p. ej. el inventario de cada local. */
  also?: string;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
  /** Plegable (acordeón): solo uno abierto a la vez; se abre solo el de la página actual. */
  collapsible?: boolean;
}

/** Apartados de cada local: `path` se añade a /app/<org>/establishments/<id>. */
export interface LocalNav {
  base: string;
  establishments: { id: string; name: string }[];
  items: { path: string; label: string; icon: PanelIconName; exact?: boolean }[];
  /** Último local visitado (cookie), para las páginas que no son de un local. */
  initialId: string | null;
}

const LAST_LOCAL_COOKIE = "nebora_last_est";

function NavList({ items, isCurrent }: { items: NavItem[]; isCurrent: (item: NavItem) => boolean }) {
  return (
    <ul>
      {items.map((item) => (
        <li key={item.href}>
          <Link href={item.href} aria-current={isCurrent(item) ? "page" : undefined}>
            <PanelIcon name={item.icon} />
            <span>{item.label}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * Navegación lateral del panel; marca la sección actual. El bloque del local
 * muestra los apartados del local abierto (o del último visitado) y, si hay
 * varios, un selector para cambiar de local. Solo es navegación: el acceso a
 * cada local lo comprueba el servidor.
 */
export function SidebarNav({
  groups,
  local,
  localAfter = 0,
  label,
}: {
  groups: NavGroup[];
  local: LocalNav | null;
  /** Número de grupos que van antes del bloque del local. */
  localAfter?: number;
  label: string;
}) {
  const pathname = usePathname();
  const isCurrent = (item: NavItem) =>
    item.exact
      ? pathname === item.href
      : pathname.startsWith(item.href) || (item.also !== undefined && new RegExp(item.also).test(pathname));

  const fromPath = local
    ? local.establishments.find((e) => pathname.startsWith(`${local.base}/establishments/${e.id}`))?.id
    : undefined;
  // Al entrar en un local se recuerda (estado ajustado durante el render, sin efecto).
  const [remembered, setRemembered] = useState(local?.initialId ?? null);
  if (fromPath && fromPath !== remembered) setRemembered(fromPath);
  const base = local?.base;
  useEffect(() => {
    if (!fromPath || !base) return;
    document.cookie = `${LAST_LOCAL_COOKIE}=${fromPath}; path=${base}; max-age=${60 * 60 * 24 * 180}; samesite=lax`;
  }, [fromPath, base]);

  const current = local
    ? (local.establishments.find((e) => e.id === (fromPath ?? remembered)) ?? local.establishments[0])
    : undefined;
  const others = local && current ? local.establishments.filter((e) => e.id !== current.id) : [];
  const localGroup =
    local && current ? (
      <div role="group" aria-label={`Local: ${current.name}`} key="local">
        {others.length > 0 ? (
          <details className="side-local">
            <summary>
              <span className="side-group">Local</span>
              <strong>{current.name}</strong>
            </summary>
            <ul aria-label="Cambiar de local">
              {others.map((e) => (
                <li key={e.id}>
                  <Link href={`${local.base}/establishments/${e.id}`}>{e.name}</Link>
                </li>
              ))}
            </ul>
          </details>
        ) : (
          <p className="side-group">{current.name}</p>
        )}
        <NavList
          isCurrent={isCurrent}
          items={local.items.map((i) => ({
            href: `${local.base}/establishments/${current.id}${i.path}`,
            label: i.label,
            icon: i.icon,
            exact: i.exact,
          }))}
        />
      </div>
    ) : null;

  // Acordeón de grupos plegables: abierto el que contiene la página actual (al
  // navegar se vuelve a ajustar, durante el render y sin efecto); al abrir uno
  // se cierra el otro, para que el menú quepa sin desplazarse.
  const currentGroup = groups.find((g) => g.collapsible && g.items.some(isCurrent))?.title ?? null;
  const [openGroup, setOpenGroup] = useState<{ path: string; title: string | null }>({
    path: pathname,
    title: currentGroup,
  });
  if (openGroup.path !== pathname) setOpenGroup({ path: pathname, title: currentGroup });

  const rendered = groups.map((group, gi) =>
    group.collapsible && group.title ? (
      <details
        key={`${group.title}-${gi}`}
        className="side-section"
        open={openGroup.title === group.title}
        onToggle={(e) => {
          const open = (e.currentTarget as HTMLDetailsElement).open;
          setOpenGroup((prev) =>
            open ? { path: pathname, title: group.title } : prev.title === group.title ? { path: pathname, title: null } : prev,
          );
        }}
      >
        <summary>
          <span className="side-group">{group.title}</span>
          <PanelIcon name="chevron" />
        </summary>
        <div role="group" aria-label={group.title}>
          <NavList items={group.items} isCurrent={isCurrent} />
        </div>
      </details>
    ) : (
      <div key={`${group.title}-${gi}`} role={group.title ? "group" : undefined} aria-label={group.title || undefined}>
        {group.title && <p className="side-group">{group.title}</p>}
        <NavList items={group.items} isCurrent={isCurrent} />
      </div>
    ),
  );

  return (
    <nav className="side-nav" aria-label={label}>
      {rendered.slice(0, localAfter)}
      {localGroup}
      {rendered.slice(localAfter)}
    </nav>
  );
}
