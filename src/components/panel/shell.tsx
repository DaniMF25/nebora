"use client";

import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { PanelIcon } from "./icons";

/**
 * Estructura del panel: barra lateral fija en escritorio y menú desplegable en
 * móvil. La barra lateral (contenido de servidor) llega como `sidebar`.
 */
export function PanelShell({ brand, sidebar, children }: { brand: ReactNode; sidebar: ReactNode; children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState<string | null>(null);
  // Se cierra al navegar: el menú solo está abierto para la ruta en que se abrió.
  const isOpen = open === pathname;
  return (
    <div className="panel" data-menu-open={isOpen ? "true" : undefined}>
      <header className="panel-topbar">
        {brand}
        <button
          type="button"
          className="icon-button"
          aria-expanded={isOpen}
          aria-controls="panel-sidebar"
          onClick={() => setOpen(isOpen ? null : pathname)}
        >
          <PanelIcon name={isOpen ? "close" : "menu"} />
          <span className="visually-hidden">{isOpen ? "Cerrar menú" : "Abrir menú"}</span>
        </button>
      </header>
      <aside id="panel-sidebar" className="panel-sidebar">
        <div className="panel-brand">{brand}</div>
        {sidebar}
      </aside>
      <main className="panel-main">{children}</main>
    </div>
  );
}
