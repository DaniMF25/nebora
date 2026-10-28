/** Estado actual del local: «Abierto»/«Cerrado» con un punto que late (verde o rojo). */
export function OpenStatus({ open, label, small = false }: { open: boolean; label: string; small?: boolean }) {
  return (
    <span className={`live-status ${open ? "is-open" : "is-closed"}${small ? " small" : ""}`}>
      <span className="live-dot" aria-hidden="true" />
      {label}
    </span>
  );
}
