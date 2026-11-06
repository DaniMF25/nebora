import Link from "next/link";
import { formatDailyPrice, formatPrice, LOCK_GRACE_DAYS, PLAN_INFO, TRIAL_DAYS } from "@/lib/plans";
import { primaryCta, type MarketingAccess } from "./shell";
import styles from "./marketing.module.css";

/** Llamada principal según la sesión y el registro, con un enlace secundario opcional. */
export function Actions({
  access,
  secondary,
  invert = false,
}: {
  access: MarketingAccess;
  secondary?: { href: string; label: string };
  invert?: boolean;
}) {
  const cta = primaryCta(access);
  return (
    <>
      <div className={styles.ctaRow}>
        {cta ? (
          <Link href={cta.href} className={invert ? styles.ctaInvert : styles.cta}>
            {access.loggedIn ? cta.label : `Empezar la prueba gratis`}
            <span aria-hidden="true">→</span>
          </Link>
        ) : (
          <Link href="/login" className={invert ? styles.ctaInvert : styles.cta}>
            Iniciar sesión
          </Link>
        )}
        {secondary && (
          <Link href={secondary.href} className={styles.textLink}>
            {secondary.label}
          </Link>
        )}
      </div>
      {!cta && <p className={styles.signupClosed}>De momento no estamos abriendo cuentas nuevas.</p>}
    </>
  );
}

/** Sello giratorio de la prueba gratuita (decorativo: el texto está al lado). */
export function TrialStamp() {
  const text = `${TRIAL_DAYS} días gratis · sin tarjeta · plan PRO · `;
  return (
    <svg className={styles.stamp} viewBox="0 0 200 200" aria-hidden="true" focusable="false">
      <defs>
        <path id="stamp-circle" d="M100,100 m-78,0 a78,78 0 1,1 156,0 a78,78 0 1,1 -156,0" />
      </defs>
      <g className={styles.stampRing}>
        <text>
          <textPath href="#stamp-circle" textLength="488">
            {text.toUpperCase()}
          </textPath>
        </text>
      </g>
      <circle cx="100" cy="100" r="58" className={styles.stampDisc} />
      <text x="100" y="112" textAnchor="middle" className={styles.stampNum}>
        {TRIAL_DAYS}
      </text>
      <text x="100" y="138" textAnchor="middle" className={styles.stampDays}>
        DÍAS
      </text>
    </svg>
  );
}

/** La prueba gratuita (D-062), explicada sin letra pequeña. */
export function TrialBand({ access }: { access: MarketingAccess }) {
  return (
    <section className={styles.trialSection} aria-labelledby="prueba">
      <div className={`${styles.wrap} ${styles.trial}`}>
        <TrialStamp />
        <div>
          <h2 id="prueba">Una semana con todo. Con tu restaurante, no con uno de ejemplo.</h2>
          <ol className={styles.trialSteps}>
            <li>
              <strong>Hoy</strong> Te das de alta con tu correo. No te pedimos tarjeta.
            </li>
            <li>
              <strong>Durante {TRIAL_DAYS} días</strong> Tienes el plan PRO: reservas, equipo, turnos, escandallos,
              inventario y compras.
            </li>
            <li>
              <strong>El día {TRIAL_DAYS + 1}</strong> Eliges tu plan, desde {formatPrice(PLAN_INFO[0]!.monthlyPrice)} al
              mes, y sigues con todo lo que hayas montado. Como no diste tarjeta, nada se cobra solo.
            </li>
          </ol>
          {!access.loggedIn && <Actions access={access} invert />}
        </div>
      </div>
    </section>
  );
}

/** Los planes como una carta de restaurante (precios de src/lib/plans.ts). */
export function PlanMenu() {
  return (
    <div className={styles.planMenu}>
      <p className={styles.planMenuTitle}>Carta de planes</p>
      <div className={styles.planCols}>
        {PLAN_INFO.map((p, i) => (
          <section
            key={p.id}
            className={`${styles.planCol} ${p.recommended ? styles.planRecommended : ""}`}
            aria-labelledby={`plan-${p.id}`}
          >
            {p.recommended && <span className={styles.planBadge}>Recomendado</span>}
            <h3 id={`plan-${p.id}`} className={styles.dishLine}>
              <span>{p.name}</span>
              <span className={styles.dots} aria-hidden="true" />
              <span className={styles.planPrice}>
                {formatPrice(p.monthlyPrice)}
                <small> /mes</small>
              </span>
            </h3>
            <p className={styles.planDaily}>Unos {formatDailyPrice(p.monthlyPrice)} al día</p>
            <p className={styles.planPitch}>{p.pitch}</p>
            <p className={styles.planFor}>{p.audience}</p>
            <ul>
              {i > 0 && <li className={styles.planInherit}>Todo lo del {PLAN_INFO[i - 1]!.name}, más:</li>}
              {p.features.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <p className={styles.planMenuNote}>
        Precios al mes, sin IVA y sin permanencia. Toda cuenta nueva empieza con {TRIAL_DAYS} días del PRO por cuenta
        de la casa.
      </p>
    </div>
  );
}

export const FAQ: { q: string; a: string }[] = [
  {
    q: "¿Me vais a pedir la tarjeta?",
    a: `No. Para la prueba de ${TRIAL_DAYS} días basta con tu correo. Como no hay tarjeta, al acabar no se cobra nada solo: decides tú si sigues y con qué plan.`,
  },
  {
    q: "¿Qué pasa cuando acaba la prueba?",
    a: `Eliges tu plan, desde ${formatPrice(PLAN_INFO[0]!.monthlyPrice)} al mes, y sigues con todo lo que hayas montado. Hasta que lo elijas, el panel queda en pausa; tu web y tu carta siguen visibles ${LOCK_GRACE_DAYS} días más. Si en ese tiempo no eliges plan, borramos tu restaurante y sus datos: no guardamos datos de nadie sin motivo.`,
  },
  {
    q: "Tengo dos locales. ¿Pago dos veces?",
    a: "No. Una cuenta agrupa todos tus locales, cada uno con su web, su carta, sus mesas y su horario. A cada persona del equipo le das acceso solo a los locales donde trabaja.",
  },
  {
    q: "¿Mis clientes tienen que descargarse algo?",
    a: "No. La carta y la web se abren en el navegador del móvil escaneando el QR o desde un enlace, y en su idioma si las has traducido.",
  },
  {
    q: "¿Sirve como TPV o para cobrar?",
    a: "No, y no lo pretende. Nébora no cobra ni cierra caja: se ocupa de la carta, la web, las reservas, el equipo y los costes de cocina.",
  },
  {
    q: "¿Puedo cambiar de plan cuando quiera?",
    a: "Sí, desde la sección «Plan» del panel. El cambio es inmediato.",
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
