import Link from "next/link";
import { formatPrice, PLAN_INFO, TRIAL_DAYS } from "@/lib/plans";
import { primaryCta, type MarketingAccess } from "./shell";
import styles from "./marketing.module.css";

/** Llamada principal según la sesión y el registro, con un enlace secundario opcional. */
export function Actions({ access, secondary }: { access: MarketingAccess; secondary?: { href: string; label: string } }) {
  const cta = primaryCta(access);
  return (
    <>
      <div className={styles.ctaRow}>
        {cta ? (
          <Link href={cta.href} className={styles.cta}>
            {access.loggedIn ? cta.label : `Probar ${TRIAL_DAYS} días gratis`}
          </Link>
        ) : (
          <Link href="/login" className={styles.cta}>
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

/** La prueba gratuita (D-062), explicada sin letra pequeña. */
export function TrialBand({ access }: { access: MarketingAccess }) {
  return (
    <section className={styles.section} aria-labelledby="prueba">
      <div className={styles.wrap}>
        <div className={styles.trial}>
          <p className={styles.trialDays} aria-hidden="true">
            {TRIAL_DAYS}
            <span>días con el plan PRO</span>
          </p>
          <div>
            <h2 id="prueba">Pruébalo con tu restaurante, no con uno de ejemplo</h2>
            <ol>
              <li>Te das de alta con tu correo. No te pedimos tarjeta.</li>
              <li>Durante {TRIAL_DAYS} días tienes todo: reservas, equipo, turnos, inventario y compras.</li>
              <li>
                Al acabar, tu cuenta pasa sola al plan Básico, que es gratis. Tu web y tus cartas siguen publicadas y
                no se borra nada.
              </li>
            </ol>
            {!access.loggedIn && <Actions access={access} />}
          </div>
        </div>
      </div>
    </section>
  );
}

/** Los tres planes con su precio (src/lib/plans.ts). */
export function PlanCards() {
  return (
    <>
      <div className={styles.plans}>
        {PLAN_INFO.map((p, i) => (
          <section key={p.id} className={styles.plan} aria-labelledby={`plan-${p.id}`}>
            <h3 id={`plan-${p.id}`}>{p.name}</h3>
            <p>{p.audience}</p>
            <div className={styles.price}>
              {formatPrice(p.monthlyPrice)}
              {p.monthlyPrice > 0 && <small>al mes + IVA</small>}
            </div>
            <ul className={styles.planFeatures}>
              {i > 0 && <li className={styles.inherit}>Lo del {PLAN_INFO[i - 1]!.name}, y además:</li>}
              {p.features.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <p className={styles.plansNote}>
        Precios al mes, sin IVA. Todas las cuentas nuevas empiezan con {TRIAL_DAYS} días del PRO; después siguen en
        Básico hasta que elijas otro plan.
      </p>
    </>
  );
}

export const FAQ: { q: string; a: string }[] = [
  {
    q: "¿Me vais a pedir la tarjeta?",
    a: `No. Para la prueba de ${TRIAL_DAYS} días basta con tu correo, y el plan Básico es gratis.`,
  },
  {
    q: "¿Y cuando acaba la prueba?",
    a: "Tu cuenta pasa al plan Básico. La web y las cartas siguen como estaban; las reservas online se desactivan y lo de los planes de pago deja de verse, pero no se borra. Si subes de plan, vuelve todo.",
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
    <dl className={styles.faq}>
      {items.map((f) => (
        <div key={f.q}>
          <dt>{f.q}</dt>
          <dd>{f.a}</dd>
        </div>
      ))}
    </dl>
  );
}
