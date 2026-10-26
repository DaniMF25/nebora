"use client";

/** Abre el diálogo de impresión del navegador (desde ahí también se guarda como PDF). */
export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()}>
      Imprimir o guardar como PDF
    </button>
  );
}
