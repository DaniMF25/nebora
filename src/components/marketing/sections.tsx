import Link from "next/link";
import { formatPrice, PLAN_INFO, TRIAL_DAYS } from "@/lib/plans";
import { MarketingIcon } from "./icons";
import { primaryCta, type MarketingAccess } from "./shell";
import styles from "./marketing.module.css";

function Check() {
  return <MarketingIcon name="check" className={styles.check} />;
}

/** Llamadas a la acción: la principal según la sesión y el registro, y una secundaria. */
export function Actions({
  access,
  secondary,
  light = false,
}: {
  access: MarketingAccess;
  secondary?: { href: string; label: string };
  light?: boolean;
}) {
  const cta = primaryCta(access);
  return (
    <>
      <div className={styles.actions}>
        {cta ? (
          <Link href={cta.href} className={light ? styles.ctaLight : styles.cta}>
            {access.loggedIn ? cta.label : `Empieza tu prueba gratis`}
          </Link>
        ) : (
          <Link href="/login" className={light ? styles.ctaLight : styles.cta}>
            Iniciar sesión
          </Link>
        )}
        {secondary && (
          <Link href={secondary.href} className={styles.ctaGhost}>
            {secondary.label}
          </Link>
        )}
      </div>
      {!cta && <p className={styles.signupClosed}>El alta de cuentas nuevas no está abierta todavía.</p>}
    </>
  );
}

/** Banda de la prueba gratuita: el gancho principal (D-062). */
export function TrialBand({ access }: { access: MarketingAccess }) {
  return (
    <section className={styles.section} aria-labelledby="prueba">
      <div className={styles.wrap}>
        <div className={styles.trial}>
          <div>
            <p className={styles.eyebrow}>Prueba gratuita</p>
            <h2 id="prueba">{TRIAL_DAYS} días con todo el plan PRO, gratis</h2>
            <p>
              Crea tu cuenta y prueba Nébora con tu restaurante de verdad: tu carta, tus mesas, tu equipo y tu cocina.
              Sin tarjeta y sin compromiso.
            </p>
            {!access.loggedIn && (
              <div className={styles.trialActions}>
                <Actions access={access} light />
              </div>
            )}
          </div>
          <ul className={styles.trialList}>
            <li>
              <Check />
              <span>Todas las funciones desde el primer minuto: reservas, equipo, inventario y compras.</span>
            </li>
            <li>
              <Check />
              <span>No pedimos tarjeta: no hay nada que cancelar.</span>
            </li>
            <li>
              <Check />
              <span>
                Al terminar pasas al plan Básico, que es gratis. No se borra nada: lo del PRO vuelve si subes de plan.
              </span>
            </li>
            <li>
              <Check />
              <span>Puedes elegir tu plan en cualquier momento desde el panel.</span>
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}

/** Tarjetas de los planes con su precio (src/lib/plans.ts). */
export function PlanCards({ access }: { access: MarketingAccess }) {
  const cta = primaryCta(access);
  return (
    <>
      <ul className={styles.plans}>
        {PLAN_INFO.map((p, i) => {
          const featured = p.id === "pro";
          return (
            <li key={p.id} className={`${styles.plan} ${featured ? styles.planFeatured : ""}`}>
              {featured && <span className={styles.planFlag}>Incluido en la prueba</span>}
              <h3>{p.name}</h3>
              <p>{p.audience}</p>
              <div className={styles.price}>
                <strong>{formatPrice(p.monthlyPrice)}</strong>
                {p.monthlyPrice > 0 && <span>al mes + IVA</span>}
              </div>
              <ul className={styles.planFeatures}>
                {i > 0 && (
                  <li>
                    <Check />
                    <strong>Todo lo del plan {PLAN_INFO[i - 1]!.name}</strong>
                  </li>
                )}
                {p.features.map((f) => (
                  <li key={f}>
                    <Check />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              {cta && (
                <Link href={cta.href} className={featured ? styles.cta : styles.ctaGhost}>
                  {access.loggedIn ? "Ir al panel" : `Probar ${TRIAL_DAYS} días gratis`}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
      <p className={styles.plansNote}>
        Precios mensuales sin IVA. Toda cuenta nueva empieza con {TRIAL_DAYS} días del plan PRO; después sigue en Básico
        hasta que elijas otro plan.
      </p>
    </>
  );
}

export const FAQ: { q: string; a: string }[] = [
  {
    q: "¿Necesito tarjeta para la prueba?",
    a: `No. Te das de alta con tu correo y tienes ${TRIAL_DAYS} días del plan PRO completo. No pedimos datos de pago.`,
  },
  {
    q: "¿Qué pasa cuando terminan los 7 días?",
    a: "Tu organización pasa sola al plan Básico, que es gratis: tu web y tus cartas siguen publicadas. Las funciones de los planes superiores dejan de verse y la reserva online se desactiva, pero no se borra nada.",
  },
  {
    q: "¿Puedo cambiar de plan más adelante?",
    a: "Sí, en cualquier momento desde «Plan» en el panel. Al subir vuelve a aparecer todo lo que tenías.",
  },
  {
    q: "Tengo varios locales, ¿me sirve?",
    a: "Sí. Una organización agrupa todos tus locales, cada uno con su web, sus cartas, sus mesas y su horario. Puedes dar acceso a cada persona del equipo solo a los locales que le tocan.",
  },
  {
    q: "¿Mis clientes tienen que instalar algo?",
    a: "No. La carta y la web se abren en el navegador del móvil, con un código QR o un enlace, y se muestran en el idioma del cliente si las has traducido.",
  },
  {
    q: "¿Nébora cobra a mis clientes o sustituye al TPV?",
    a: "No. Nébora no es un TPV ni procesa pagos: se ocupa de la carta, la web, las reservas, el equipo y la gestión de cocina.",
  },
];

export function Faq({ items = FAQ }: { items?: { q: string; a: string }[] }) {
  return (
    <div className={styles.faq}>
      {items.map((f) => (
        <details key={f.q}>
          <summary>{f.q}</summary>
          <p>{f.a}</p>
        </details>
      ))}
    </div>
  );
}
