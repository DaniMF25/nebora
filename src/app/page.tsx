import type { Metadata } from "next";
import Link from "next/link";
import { Actions, Faq, PlanCards, TrialBand } from "@/components/marketing/sections";
import { MarketingShell, type MarketingAccess } from "@/components/marketing/shell";
import { Tour, type TourStep } from "@/components/marketing/tour";
import styles from "@/components/marketing/marketing.module.css";
import { TRIAL_DAYS } from "@/lib/plans";
import { getCurrentUser } from "@/server/auth/current-user";
import { getEnv } from "@/server/config/env";

export const metadata: Metadata = {
  title: "Nébora · Software para restaurantes: carta con QR, web, reservas y cocina",
  description: `Carta digital con QR, web del restaurante, reservas, turnos del equipo y coste de cada plato. Pruébalo ${TRIAL_DAYS} días con todo incluido, sin tarjeta.`,
};

const PANEL = { width: 1600, height: 1000 };

// Capturas reales del panel con un restaurante de ejemplo (scripts/marketing-screenshots.ts).
const TOUR: TourStep[] = [
  {
    id: "reservas",
    label: "Reservas",
    title: "Las reservas del día, cada una con su mesa",
    text: "Las que entran por tu web llegan aquí con la mesa ya asignada y sin solaparse con otras. Las del teléfono las apuntas en un momento, y al llegar el cliente lo marcas como sentado o como que no vino.",
    plan: "Desde el plan Avanzado",
    image: { src: "/marketing/panel-reservas.webp", alt: "Lista de reservas de un viernes con hora, nombre, comensales, mesa y teléfono", ...PANEL },
  },
  {
    id: "sala",
    label: "Sala",
    title: "Tu sala, tal como la tienes montada",
    text: "Dibuja el salón y la terraza con sus mesas, redondas o cuadradas, y muévelas arrastrando. Al reservar se busca la mesa que mejor encaja con el número de comensales.",
    plan: "Desde el plan Avanzado",
    image: { src: "/marketing/panel-sala.webp", alt: "Plano del salón con siete mesas colocadas en una cuadrícula", ...PANEL },
  },
  {
    id: "turnos",
    label: "Turnos",
    title: "El cuadrante de la semana, sin hojas sueltas",
    text: "Quién trabaja cada día y en qué horario, con las horas que suma cada persona. Si alguien ya tiene turno a esa hora, el panel no te deja ponerle otro. Copias la semana anterior con un clic.",
    plan: "Desde el plan Avanzado",
    image: { src: "/marketing/panel-turnos.webp", alt: "Cuadrante semanal con cinco personas, sus horarios por día y las horas totales", ...PANEL },
  },
  {
    id: "escandallo",
    label: "Escandallos",
    title: "Lo que te cuesta cada plato",
    text: "Apuntas la receta con sus cantidades y Nébora calcula el coste por ración con el precio de cada ingrediente. En el ejemplo, una ración de croquetas cuesta 3,01 € y se vende a 9,50 €.",
    plan: "Plan PRO",
    image: { src: "/marketing/panel-escandallo.webp", alt: "Escandallo de croquetas: coste 3,01 €, precio 9,50 €, margen 6,49 € y receta con cinco ingredientes", ...PANEL },
  },
  {
    id: "stock",
    label: "Inventario",
    title: "Qué hay en cada almacén",
    text: "Entradas, salidas, traspasos y recuentos, con el stock al día. Cuando algo baja del mínimo que has marcado, te avisa en el inicio. Los pedidos a proveedores suman al stock al recibirlos.",
    plan: "Plan PRO",
    image: { src: "/marketing/panel-stock.webp", alt: "Stock por almacén con dos ingredientes por debajo del mínimo", ...PANEL },
  },
];

const PHONE = { width: 780, height: 1688 };

async function access(): Promise<MarketingAccess> {
  return { loggedIn: Boolean(await getCurrentUser()), signupEnabled: getEnv().AUTH_ALLOW_SIGNUP === "true" };
}

/** Web pública de Nébora (D-063, D-064): qué ofrece, con capturas reales, la prueba y los planes. */
export default async function Home() {
  const a = await access();
  return (
    <MarketingShell access={a} current="home">
      <section className={styles.hero} aria-labelledby="titular">
        <div className={styles.wrap}>
          <div className={styles.heroText}>
            <h1 id="titular">Menos papeles y más servicio en tu restaurante.</h1>
            <p className={styles.lead}>
              Nébora es el programa con el que llevas la carta con QR, la web del local, las reservas, los turnos del
              equipo y el coste de cada plato. Se monta en una tarde y lo puedes probar {TRIAL_DAYS} días con todo
              incluido, sin dar la tarjeta.
            </p>
            <Actions access={a} secondary={{ href: "/precios", label: "Ver precios" }} />
          </div>
          <div className={styles.heroStage}>
            <div className={styles.browser}>
              <div className={styles.browserBar} aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element -- captura estática ya optimizada (WebP) */}
              <img
                src="/marketing/panel-inicio.webp"
                alt="Inicio del panel de un restaurante: reservas de hoy, comensales, stock bajo mínimo y pedidos pendientes"
                width={1600}
                height={650}
                fetchPriority="high"
              />
            </div>
            <div className={styles.heroPhone} aria-hidden="true">
              <PhoneCycle />
            </div>
          </div>
        </div>
      </section>

      <section id="panel" className={`${styles.section} ${styles.sectionDeep}`} aria-labelledby="panel-titulo">
        <div className={styles.wrap}>
          <div className={styles.split}>
            <h2 id="panel-titulo">Un viernes cualquiera en La Lonja del Puerto</h2>
            <p className={styles.intro}>
              Un restaurante de ejemplo con dos turnos, once mesas y cinco personas en plantilla. Esto es lo que ve su
              encargada en el panel.
            </p>
          </div>
          <Tour steps={TOUR} />
          <p className={styles.caption}>Capturas del panel de Nébora con datos de ejemplo.</p>
        </div>
      </section>

      <section id="web" className={styles.section} aria-labelledby="web-titulo">
        <div className={styles.wrap}>
          <div className={styles.split}>
            <h2 id="web-titulo">Y esto es lo que ven tus clientes</h2>
            <p className={styles.intro}>
              Cada local tiene su web con la carta, el horario y el botón de reservar. No hay que instalar nada: se
              abre en el móvil desde el QR de la mesa, desde Google o desde tu Instagram.
            </p>
          </div>
          <div className={styles.phones}>
            <figure>
              <Phone src="/marketing/web-portada.webp" alt="Portada de la web del restaurante en un móvil" />
              <figcaption>
                <strong>La portada</strong>
                <span>Con tu nombre, tu horario y la reserva a un toque.</span>
              </figcaption>
            </figure>
            <figure>
              <Phone src="/marketing/web-historia.webp" alt="Historia a pantalla completa anunciando la apertura de la terraza" />
              <figcaption>
                <strong>Historias</strong>
                <span>Para avisar de la terraza, un evento o un cambio de horario.</span>
              </figcaption>
            </figure>
            <figure>
              <Phone src="/marketing/web-carta.webp" alt="Carta digital con platos, precios y alérgenos" />
              <figcaption>
                <strong>La carta</strong>
                <span>Con alérgenos y precios. La cambias y se actualiza al momento.</span>
              </figcaption>
            </figure>
          </div>
          <dl className={styles.facts}>
            <div>
              <dt>Un QR que no caduca</dt>
              <dd>Imprímelo una vez. Aunque cambies platos o precios, sigue llevando a la carta buena.</dd>
            </div>
            <div>
              <dt>En siete idiomas</dt>
              <dd>Traduce la carta y la web a inglés, francés, alemán, italiano, portugués y catalán.</dd>
            </div>
            <div>
              <dt>También en papel</dt>
              <dd>Saca la carta para imprimir en A4, con su QR, desde la misma pantalla.</dd>
            </div>
          </dl>
        </div>
      </section>

      <TrialBand access={a} />

      <section className={`${styles.section} ${styles.sectionDeep}`} aria-labelledby="planes">
        <div className={styles.wrap}>
          <div className={styles.split}>
            <h2 id="planes">Tres planes, y el primero es gratis</h2>
            <p className={styles.intro}>
              Empieza con la carta y la web, y sube cuando necesites reservas, equipo o cocina.{" "}
              <Link href="/precios" className={styles.textLink}>
                Ver la comparativa completa
              </Link>
              .
            </p>
          </div>
          <PlanCards />
        </div>
      </section>

      <section id="preguntas" className={styles.section} aria-labelledby="preguntas-titulo">
        <div className={styles.wrap}>
          <h2 id="preguntas-titulo">Preguntas que nos hacen</h2>
          <Faq />
        </div>
      </section>

      <section className={styles.closing} aria-labelledby="cierre">
        <div className={styles.wrap}>
          <h2 id="cierre">Monta tu carta esta tarde y mañana la tienes en las mesas.</h2>
          <Actions access={a} />
          <p className={styles.fine}>Sin tarjeta. Si no te convence, te quedas en el plan gratuito.</p>
        </div>
      </section>
    </MarketingShell>
  );
}

function Phone({ src, alt }: { src: string; alt: string }) {
  return (
    <div className={styles.phone}>
      <div className={styles.phoneScreen}>
        {/* eslint-disable-next-line @next/next/no-img-element -- captura estática ya optimizada (WebP) */}
        <img src={src} alt={alt} loading="lazy" decoding="async" {...PHONE} />
      </div>
    </div>
  );
}

/** Móvil de la portada: la web del restaurante pasa por sus tres pantallas (solo CSS). */
function PhoneCycle() {
  return (
    <div className={styles.phone}>
      <div className={`${styles.phoneScreen} ${styles.cycle}`}>
        {["web-portada", "web-historia", "web-carta"].map((n) => (
          // eslint-disable-next-line @next/next/no-img-element -- captura estática ya optimizada (WebP)
          <img key={n} src={`/marketing/${n}.webp`} alt="" decoding="async" {...PHONE} />
        ))}
      </div>
    </div>
  );
}
