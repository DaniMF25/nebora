import type { Metadata } from "next";
import { CostingDemo } from "@/components/marketing/costing-demo";
import { FloorDemo } from "@/components/marketing/floor-demo";
import { Gallery, type Shot } from "@/components/marketing/gallery";
import { MenuDemo } from "@/components/marketing/menu-demo";
import { Actions, Faq, PlanMenu, TrialBand } from "@/components/marketing/sections";
import { MarketingShell, type MarketingAccess } from "@/components/marketing/shell";
import { TicketPrinter } from "@/components/marketing/ticket-printer";
import styles from "@/components/marketing/marketing.module.css";
import { formatPrice, PLAN_INFO, TRIAL_DAYS } from "@/lib/plans";
import { getCurrentUser } from "@/server/auth/current-user";
import { getEnv } from "@/server/config/env";

export const metadata: Metadata = {
  title: "Nébora · Carta con QR, web, reservas y cocina para tu restaurante",
  description: `Carta digital con QR, web del restaurante, reservas con plano de sala, turnos del equipo y escandallos. Pruébalo ${TRIAL_DAYS} días con todo incluido, sin tarjeta.`,
};

const KINDS = ["Arrocerías", "Bares de tapas", "Pizzerías", "Cafeterías", "Marisquerías", "Tabernas", "Hamburgueserías", "Asadores", "Brunch"];

// Capturas reales del panel con el restaurante de ejemplo (scripts/marketing-screenshots.ts).
const SHOTS: Shot[] = [
  { src: "/marketing/panel-inicio.webp", alt: "Inicio del panel: reservas de hoy, comensales y avisos de stock, pedidos y escandallos", title: "Inicio.", text: "Lo de hoy de un vistazo: reservas, comensales y lo que necesita tu atención.", width: 1600, height: 650 },
  { src: "/marketing/panel-reservas.webp", alt: "Lista de reservas de un viernes con hora, nombre, comensales, mesa y teléfono", title: "Reservas.", text: "Las de la web y las del teléfono juntas, con su mesa. Sentar, no vino o cancelar con un toque." },
  { src: "/marketing/panel-turnos.webp", alt: "Cuadrante semanal con cinco personas, sus horarios por día y las horas totales", title: "Turnos.", text: "El cuadrante de la semana con las horas de cada uno. Cada persona ve sus turnos al entrar." },
  { src: "/marketing/panel-stock.webp", alt: "Stock por almacén con dos ingredientes por debajo del mínimo", title: "Inventario.", text: "Lo que hay en cada almacén, con aviso cuando algo baja del mínimo." },
  { src: "/marketing/panel-escandallo.webp", alt: "Escandallo de croquetas: coste, precio, margen y receta con cinco ingredientes", title: "Escandallos.", text: "La receta de cada plato con su coste por ración, calculado con tus precios." },
  { src: "/marketing/panel-sala.webp", alt: "Plano del salón con siete mesas colocadas en una cuadrícula", title: "Sala.", text: "Dibuja tus zonas y mesas arrastrándolas, tal como están en el local." },
];

async function access(): Promise<MarketingAccess> {
  return { loggedIn: Boolean(await getCurrentUser()), signupEnabled: getEnv().AUTH_ALLOW_SIGNUP === "true" };
}

/** Web pública de Nébora (D-063, D-065): la cocina en marcha, con demos que funcionan y capturas reales. */
export default async function Home() {
  const a = await access();
  return (
    <MarketingShell access={a} current="home">
      <section className={styles.hero} aria-labelledby="titular">
        <div className={`${styles.wrap} ${styles.heroGrid}`}>
          <div>
            <p className={styles.kicker}>
              <b>Nuevo</b> Prueba el plan PRO {TRIAL_DAYS} días, sin tarjeta
            </p>
            <h1 id="titular">
              Más mesas llenas. <span className={styles.strike}>Menos papelitos</span>. <em>Cero</em> líos.
            </h1>
            <p className={styles.lead}>
              La carta con QR, la web del local, las reservas con su mesa, los turnos del equipo y lo que te cuesta
              cada plato. Todo en Nébora, desde el móvil o el ordenador del pase.
            </p>
            <Actions access={a} secondary={{ href: "/precios", label: "Ver precios" }} />
            <p className={styles.heroNote}>
              Sin tarjeta y sin permanencia. Después, desde {formatPrice(PLAN_INFO[0]!.monthlyPrice)} al mes.
            </p>
          </div>
          <TicketPrinter />
        </div>
      </section>

      <div className={styles.ribbon} aria-hidden="true">
        <div className={styles.ribbonTrack}>
          {[...KINDS, ...KINDS].map((k, i) => (
            <span key={i}>{k}</span>
          ))}
        </div>
      </div>

      <section id="sala" className={`${styles.section} ${styles.sectionDark}`} aria-labelledby="sala-titulo">
        <div className={styles.wrap}>
          <div className={styles.sectionHead}>
            <span className={styles.num} aria-hidden="true">
              01
            </span>
            <h2 id="sala-titulo">La sala, a la hora que quieras</h2>
            <p className={styles.intro}>
              Así va el viernes en La Lonja del Puerto, nuestro restaurante de ejemplo: once mesas, nueve reservas y dos
              servicios.
            </p>
          </div>
          <div className={`${styles.demoRow} ${styles.reveal}`}>
            <div className={styles.demoText}>
              <p className={styles.tryIt}>Mueve la hora</p>
              <h3>Cada reserva, con su mesa</h3>
              <p>
                Las reservas que entran por tu web llegan con la mesa ya asignada: la que mejor encaja con los
                comensales y libre a esa hora. Nunca dos reservas en la misma mesa.
              </p>
              <p>Las del teléfono las apuntas tú en un momento, y la lista de espera avisa cuando queda hueco.</p>
              <span className={styles.planTag}>Desde el plan Avanzado</span>
            </div>
            <FloorDemo />
          </div>
        </div>
      </section>

      <section id="cocina" className={styles.section} aria-labelledby="cocina-titulo">
        <div className={styles.wrap}>
          <div className={styles.sectionHead}>
            <span className={styles.num} aria-hidden="true">
              02
            </span>
            <h2 id="cocina-titulo">Cuánto te cuesta cada plato, de verdad</h2>
            <p className={styles.intro}>
              Apuntas la receta una vez y Nébora calcula el coste con el precio de cada ingrediente. Si sube el jamón,
              lo ves en el momento.
            </p>
          </div>
          <div className={`${styles.demoRow} ${styles.demoRowFlip} ${styles.reveal}`}>
            <div className={styles.demoText}>
              <p className={styles.tryIt}>Cambia los precios</p>
              <h3>Croquetas de jamón ibérico</h3>
              <p>
                Cinco ingredientes, una ración. Es el mismo cálculo que hace el panel con cada plato de tu carta, y el
                que te avisa de los platos a los que les falta receta.
              </p>
              <p>Además: stock por almacén, recuentos, pedidos a proveedores y avisos de stock bajo.</p>
              <span className={styles.planTag}>Plan PRO</span>
            </div>
            <CostingDemo />
          </div>
        </div>
      </section>

      <section id="carta" className={`${styles.section} ${styles.sectionDark}`} aria-labelledby="carta-titulo">
        <div className={styles.wrap}>
          <div className={styles.sectionHead}>
            <span className={styles.num} aria-hidden="true">
              03
            </span>
            <h2 id="carta-titulo">Tu carta, en el idioma de cada mesa</h2>
            <p className={styles.intro}>
              La carta y la web de tu local se abren en el móvil desde el QR de la mesa, sin instalar nada. Y se
              muestran en el idioma del cliente si las has traducido.
            </p>
          </div>
          <div className={`${styles.demoRow} ${styles.reveal}`}>
            <div className={styles.demoText}>
              <p className={styles.tryIt}>Cambia el idioma</p>
              <h3>Siete idiomas, un solo QR</h3>
              <p>
                Español, inglés, francés, alemán, italiano, portugués y catalán. Traduces cada plato una vez, y si
                cambias el original te avisamos de qué traducción hay que repasar.
              </p>
              <p>
                El QR no caduca: aunque cambies platos o precios, lleva siempre a la carta buena. Y la sacas en papel,
                lista para imprimir, desde la misma pantalla.
              </p>
              <span className={styles.planTag}>Todos los planes</span>
            </div>
            <MenuDemo />
          </div>
        </div>
      </section>

      <section className={`${styles.section} ${styles.sectionPaper}`} aria-labelledby="web-titulo">
        <div className={styles.wrap}>
          <div className={styles.sectionHead}>
            <span className={styles.num} aria-hidden="true">
              04
            </span>
            <h2 id="web-titulo">Una web que parece hecha a medida</h2>
            <p className={styles.intro}>
              Cada local tiene su web con tu logo, tu color y tu estilo: portada, carta, horario, contacto, reservas e
              historias para anunciar la terraza o el menú de Navidad.
            </p>
          </div>
          <div className={`${styles.phonesRow} ${styles.reveal}`}>
            {[
              ["web-portada", "La portada", "Tu nombre, el horario y reservar a un toque.", "Portada de la web del restaurante en un móvil"],
              ["web-historia", "Historias", "Para avisar de una novedad nada más entrar.", "Historia a pantalla completa anunciando la apertura de la terraza"],
              ["web-carta", "La carta", "Con alérgenos y precios, siempre al día.", "Carta digital con platos, precios y alérgenos"],
            ].map(([file, title, text, alt]) => (
              <figure key={file}>
                <div className={styles.phone}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- captura estática ya optimizada (WebP) */}
                  <img src={`/marketing/${file}.webp`} alt={alt} width={780} height={1688} loading="lazy" decoding="async" />
                </div>
                <figcaption>
                  <strong>{title}</strong>
                  <span>{text}</span>
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="panel-titulo">
        <div className={styles.wrap}>
          <div className={styles.sectionHead}>
            <span className={styles.num} aria-hidden="true">
              05
            </span>
            <h2 id="panel-titulo">El panel, por dentro</h2>
            <p className={styles.intro}>Capturas reales de Nébora con los datos de La Lonja del Puerto.</p>
          </div>
          <Gallery shots={SHOTS} />
        </div>
      </section>

      <TrialBand access={a} />

      <section className={styles.section} aria-labelledby="planes">
        <div className={styles.wrap}>
          <div className={styles.sectionHead}>
            <span className={styles.num} aria-hidden="true">
              06
            </span>
            <h2 id="planes">Precios claros, como una buena carta</h2>
            <p className={styles.intro}>
              Desde {formatPrice(PLAN_INFO[0]!.monthlyPrice)} al mes, menos que un café al día. Subes cuando necesites
              reservas, equipo o cocina, y bajas cuando quieras.
            </p>
          </div>
          <div className={styles.reveal}>
            <PlanMenu />
          </div>
        </div>
      </section>

      <section id="preguntas" className={`${styles.section} ${styles.sectionPaper}`} aria-labelledby="preguntas-titulo">
        <div className={styles.wrap}>
          <div className={styles.sectionHead}>
            <span className={styles.num} aria-hidden="true">
              07
            </span>
            <h2 id="preguntas-titulo">Lo que nos preguntan en la barra</h2>
          </div>
          <Faq />
        </div>
      </section>

      <section className={styles.closing} aria-labelledby="cierre">
        <div className={styles.wrap}>
          <h2 id="cierre">
            ¿Abrimos <em>cocina</em>?
          </h2>
          <p>Monta tu carta esta tarde y mañana la tienes en las mesas. {TRIAL_DAYS} días con todo, sin tarjeta.</p>
          <Actions access={a} />
        </div>
      </section>
    </MarketingShell>
  );
}
