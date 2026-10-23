"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelIcon, type PanelIconName } from "./icons";

export interface NavItem {
  href: string;
  label: string;
  icon: PanelIconName;
  /** Activo solo en la ruta exacta (la portada); el resto, también en sus subpáginas. */
  exact?: boolean;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

/** Navegación lateral del panel; marca la sección actual. */
export function SidebarNav({ groups, label }: { groups: NavGroup[]; label: string }) {
  const pathname = usePathname();
  const isCurrent = (item: NavItem) => (item.exact ? pathname === item.href : pathname.startsWith(item.href));
  return (
    <nav className="side-nav" aria-label={label}>
      {groups.map((group, gi) => (
        <div key={`${group.title}-${gi}`} role={group.title ? "group" : undefined} aria-label={group.title || undefined}>
          {group.title && <p className="side-group">{group.title}</p>}
          <ul>
            {group.items.map((item) => (
              <li key={item.href}>
                <Link href={item.href} aria-current={isCurrent(item) ? "page" : undefined}>
                  <PanelIcon name={item.icon} />
                  <span>{item.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
