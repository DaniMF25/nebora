import type { Metadata } from "next";
import Link from "next/link";
import { MarketingIcon, type MarketingIconName } from "@/components/marketing/icons";
import { Actions, Faq, PlanCards, TrialBand } from "@/components/marketing/sections";
import { MarketingShell, type MarketingAccess } from "@/components/marketing/shell";
import styles from "@/components/marketing/marketing.module.css";
import { TRIAL_DAYS } from "@/lib/plans";
import { getCurrentUser } from "@/server/auth/current-user";
import { getEnv } from "@/server/config/env";

export const metadata: Metadata = {
  title: "Nébora · Carta digital, web, reservas y gestión para restaurantes",
  description: `Carta digital con QR, web del restaurante, reservas online, equipo, inventario y compras en un solo sitio. Pruébalo gratis ${TRIAL_DAYS} días, sin tarjeta.`,
};

const FEATURES: { icon: MarketingIconName; title: string; text: string; plan: string }[] = [
  {
    icon: "menu",
    title: "Cartas digitales con QR",
    text: "Platos con fotos, alérgenos y precios por ración. Cartas por horario, sugerencias del día y versión para imprimir.",
    plan: "Todos los planes",
  },
  {
    icon: "web",
    title: "La web de tu restaurante",
    text: "Portada, horario, contacto y tu carta, con tu logotipo. Desde Avanzado, estilos, colores, galería e historias para anunciar novedades.",
    plan: "Todos los planes",
  },
  {
    icon: "globe",
    title: "En el idioma de tus clientes",
    text: "Traduce la carta y la web a inglés, francés, alemán, italiano, portugués y catalán. Cada cliente la ve en el suyo.",
    plan: "Todos los planes",
  },
  {
    icon: "calendar",
    title: "Reservas online y sala",
    text: "Reservas desde tu web con mesa asignada sola y sin solapes, plano de sala, lista de espera y cancelación por el cliente.",
    plan: "Desde Avanzado",
  },
  {
    icon: "team",
    title: "Equipo y turnos",
    text: "Invita a tu equipo con su rol y sus locales. Cuadrante semanal de turnos y cada persona ve los suyos al entrar.",
    plan: "Desde Avanzado",
  },
  {
    icon: "chart",
    title: "Estadísticas",
    text: "Visitas a la web y a las cartas, escaneos del QR y, con reservas, el resumen del periodo. Exportación a Excel desde Avanzado.",
    plan: "Todos los planes",
  },
  {
    icon: "box",
    title: "Inventario y escandallos",
    text: "Recetas con coste por plato, stock por almacén, movimientos, traspasos y recuentos, con avisos de stock bajo.",
    plan: "PRO",
  },
  {
    icon: "truck",
    title: "Proveedores y compras",
    text: "Pedidos de compra a tus proveedores y recepción total o parcial, que suma al stock sin hacer cuentas.",
    plan: "PRO",
  },
];

async function access(): Promise<MarketingAccess> {
  return { loggedIn: Boolean(await getCurrentUser()), signupEnabled: getEnv().AUTH_ALLOW_SIGNUP === "true" };
}

/** Web pública de Nébora (D-063): qué ofrece, la prueba gratuita y los planes. El panel está en /app. */
export default async function Home() {
  const a = await access();
  return (
    <MarketingShell access={a} current="home">
      <section className={styles.hero} aria-labelledby="titular">
        <div className={`${styles.wrap} ${styles.heroGrid}`}>
          <div>
            <span className={styles.pill}>{TRIAL_DAYS} días gratis del plan PRO · sin tarjeta</span>
            <h1 id="titular">
              Tu restaurante, <em>en orden</em>: de la carta a la cocina.
            </h1>
            <p className={styles.lead}>
              Nébora reúne la carta digital con QR, la web de tu local, las reservas, el equipo y el control de stock y
              compras. Sin instalar nada y desde el móvil o el ordenador.
            </p>
            <Actions access={a} secondary={{ href: "/precios", label: "Ver planes y precios" }} />
            <ul className={styles.promises}>
              <li>
                <MarketingIcon name="check" className={styles.check} /> Todo el plan PRO durante {TRIAL_DAYS} días
              </li>
              <li>
                <MarketingIcon name="check" className={styles.check} /> Sin tarjeta
              </li>
              <li>
                <MarketingIcon name="check" className={styles.check} /> Después, plan Básico gratis
              </li>
            </ul>
          </div>
          {/* Ilustración: una carta de ejemplo en un móvil. */}
          <div className={styles.mock} aria-hidden="true">
            <div className={styles.phone}>
              <div className={styles.screen}>
                <div className={styles.screenTop}>
                  <strong>Casa Ejemplo</strong>
                  <span>Abierto · cocina hasta las 23:30</span>
                </div>
                <div className={styles.stories}>
                  <span />
                  <span />
                  <span />
                </div>
                <ul className={styles.dishes}>
                  <li>
                    <b>Croquetas caseras</b> <span>9,50 €</span>
                  </li>
                  <li>
                    <b>Ensalada de temporada</b> <span>11,00 €</span>
                  </li>
                  <li>
                    <b>Arroz del día</b> <span>16,50 €</span>
                  </li>
                  <li>
                    <b>Tarta de queso</b> <span>6,00 €</span>
                  </li>
                </ul>
              </div>
            </div>
            <div className={styles.mockBadge}>
              <span>Reserva online</span>
              <strong>4 personas · 21:00</strong>
            </div>
            <div className={`${styles.mockBadge} ${styles.mockBadgeRight}`}>
              <span>Código QR</span>
              <strong>Carta publicada</strong>
            </div>
          </div>
        </div>
      </section>

      <section id="funciones" className={`${styles.section} ${styles.sectionAlt}`} aria-labelledby="funciones-titulo">
        <div className={styles.wrap}>
          <div className={styles.sectionHead}>
            <p className={styles.eyebrow}>Qué incluye</p>
            <h2 id="funciones-titulo">Todo lo que necesita tu restaurante, sin hojas de cálculo</h2>
            <p>Empieza por la carta y la web, y añade reservas, equipo y cocina cuando lo necesites.</p>
          </div>
          <ul className={styles.features}>
            {FEATURES.map((f) => (
              <li key={f.title} className={styles.feature}>
                <span className={styles.featureIcon}>
                  <MarketingIcon name={f.icon} />
                </span>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
                <span className={styles.planTag}>{f.plan}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="como-funciona">
        <div className={styles.wrap}>
          <div className={styles.sectionHead}>
            <p className={styles.eyebrow}>Cómo funciona</p>
            <h2 id="como-funciona">En marcha en una tarde</h2>
          </div>
          <ol className={styles.steps}>
            <li>
              <h3>Crea tu cuenta</h3>
              <p>Con tu correo, sin tarjeta. Empiezas con {TRIAL_DAYS} días del plan PRO.</p>
            </li>
            <li>
              <h3>Da de alta tu local</h3>
              <p>Dirección, horario y, si quieres, las mesas y tu equipo.</p>
            </li>
            <li>
              <h3>Publica y comparte</h3>
              <p>Añade tus platos, elige el estilo de tu web, publica e imprime el QR para las mesas.</p>
            </li>
          </ol>
        </div>
      </section>

      <TrialBand access={a} />

      <section className={`${styles.section} ${styles.sectionAlt}`} aria-labelledby="planes">
        <div className={styles.wrap}>
          <div className={styles.sectionHead}>
            <p className={styles.eyebrow}>Planes</p>
            <h2 id="planes">Un plan para cada momento de tu negocio</h2>
            <p>
              Empieza gratis con el Básico y sube cuando lo necesites. <Link href="/precios">Compara los planes</Link>.
            </p>
          </div>
          <PlanCards access={a} />
        </div>
      </section>

      <section id="preguntas" className={styles.section} aria-labelledby="preguntas-titulo">
        <div className={styles.wrap}>
          <div className={styles.sectionHead}>
            <p className={styles.eyebrow}>Preguntas frecuentes</p>
            <h2 id="preguntas-titulo">Lo que suelen preguntarnos</h2>
          </div>
          <Faq />
        </div>
      </section>

      <section className={`${styles.section} ${styles.sectionAlt} ${styles.closing}`} aria-labelledby="cierre">
        <div className={styles.wrap}>
          <h2 id="cierre">Pruébalo con tu restaurante esta semana</h2>
          <p>
            {TRIAL_DAYS} días con todas las funciones, sin tarjeta. Si no te convence, te quedas en el plan Básico
            gratis.
          </p>
          <Actions access={a} />
        </div>
      </section>
    </MarketingShell>
  );
}
