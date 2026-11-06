import type { Metadata } from "next";
import { Faq, FAQ, PlanMenu, TrialBand } from "@/components/marketing/sections";
import { MarketingShell } from "@/components/marketing/shell";
import styles from "@/components/marketing/marketing.module.css";
import { formatPrice, PLAN_INFO, TRIAL_DAYS } from "@/lib/plans";
import { getCurrentUser } from "@/server/auth/current-user";
import { getEnv } from "@/server/config/env";

export const metadata: Metadata = {
  title: "Precios · Nébora",
  description: `Planes Básico, Avanzado y PRO de Nébora. Empieza con ${TRIAL_DAYS} días gratis del plan PRO, sin tarjeta.`,
};

/** Comparativa: cada fila es una función y el plan mínimo que la incluye. */
const ROWS: { label: string; from: 0 | 1 | 2 }[] = [
  { label: "Web del restaurante con horario y contacto", from: 0 },
  { label: "Cartas digitales con QR y versión para imprimir", from: 0 },
  { label: "Traducciones a 6 idiomas", from: 0 },
  { label: "Estadísticas de visitas y escaneos", from: 0 },
  { label: "Estilos, colores, galería e historias en la web", from: 1 },
  { label: "Reservas online, plano de sala y lista de espera", from: 1 },
  { label: "Formulario de contacto con bandeja de mensajes", from: 1 },
  { label: "Equipo con roles y acceso por local", from: 1 },
  { label: "Personal y cuadrante de turnos", from: 1 },
  { label: "Exportaciones a Excel", from: 1 },
  { label: "Recetas, escandallos y coste por plato", from: 2 },
  { label: "Inventario por almacén y recuentos", from: 2 },
  { label: "Proveedores y pedidos de compra", from: 2 },
];
const COLUMNS = ["Básico", "Avanzado", "PRO"];

export default async function PricingPage() {
  const access = { loggedIn: Boolean(await getCurrentUser()), signupEnabled: getEnv().AUTH_ALLOW_SIGNUP === "true" };
  return (
    <MarketingShell access={access} current="pricing">
      <section className={styles.pricingHero} aria-labelledby="titular">
        <div className={styles.wrap}>
          <h1 id="titular">Precios</h1>
          <p className={styles.lead}>
            Los primeros {TRIAL_DAYS} días tienes el PRO completo sin pagar nada y sin dar la tarjeta. Después eliges el
            plan que te encaje, desde {formatPrice(PLAN_INFO[0]!.monthlyPrice)} al mes.
          </p>
          <PlanMenu />
        </div>
      </section>

      <section className={`${styles.section} ${styles.sectionPaper}`} aria-labelledby="comparativa">
        <div className={styles.wrap}>
          <div className={styles.headPlain}>
            <h2 id="comparativa">Plan por plan</h2>
          </div>
          <div>
            <table className={styles.compare}>
              <thead>
                <tr>
                  <th scope="col">Función</th>
                  {COLUMNS.map((c) => (
                    <th key={c} scope="col">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ROWS.map((r) => (
                  <tr key={r.label}>
                    <th scope="row">{r.label}</th>
                    {COLUMNS.map((c, i) =>
                      i >= r.from ? (
                        <td key={c} className={styles.yes}>
                          ✓<span className="visually-hidden"> Incluido</span>
                        </td>
                      ) : (
                        <td key={c} className={styles.no}>
                          —<span className="visually-hidden"> No incluido</span>
                        </td>
                      ),
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <TrialBand access={access} />

      <section className={styles.section} aria-labelledby="preguntas-titulo">
        <div className={styles.wrap}>
          <div className={styles.headPlain}>
            <h2 id="preguntas-titulo">Preguntas frecuentes</h2>
          </div>
          <Faq items={[FAQ[0]!, FAQ[1]!, FAQ[2]!, FAQ[5]!]} />
        </div>
      </section>
    </MarketingShell>
  );
}
