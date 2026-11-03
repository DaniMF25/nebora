import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { PageTabs, pickTab } from "@/components/panel/page-tabs";
import { requireUser } from "@/server/auth/current-user";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { listMessages, type ContactTopic } from "@/server/modules/contact/service";
import { getEstablishment } from "@/server/modules/establishments/service";
import { withTenant } from "@/server/tenancy/context";
import { deleteMessageAction, setMessageStatusAction } from "./actions";

const TABS = ["recibidos", "archivados"] as const;

/** Motivo elegido en el formulario (D-052). */
const TOPIC_LABELS: Record<ContactTopic, string> = {
  group: "Reserva de grupo",
  event: "Evento o celebración",
  allergies: "Alergias e intolerancias",
  other: "Otra consulta",
};

/** Bandeja de mensajes del formulario de contacto de la web (D-049). */
export default async function MessagesPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string; estId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { orgId, estId } = await params;
  const tab = pickTab((await searchParams).tab, TABS);
  const user = await requireUser();
  let data;
  try {
    data = await withTenant(user, orgId, async (tx, ctx) => ({
      establishment: await getEstablishment(tx, ctx, estId),
      messages: await listMessages(tx, ctx, estId, { archived: tab === "archivados" }),
      canManage: ctx.permissions.has("messages.manage"),
    }));
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof ForbiddenError) notFound();
    throw err;
  }
  const { establishment, messages, canManage } = data;
  const when = new Intl.DateTimeFormat("es-ES", {
    timeZone: establishment.timezone,
    dateStyle: "medium",
    timeStyle: "short",
  });
  const unread = messages.filter((m) => m.status === "new").length;

  return (
    <>
      <p>
        <Link href={`/app/${orgId}/establishments/${estId}`}>← {establishment.name}</Link>
      </p>
      <h2>Mensajes</h2>
      <p className="muted">
        Lo que te escriben desde el formulario de contacto de tu web. Todavía no se envían por correo: revísalos aquí y
        responde por teléfono o correo. Se conservan según el plazo de privacidad.
      </p>
      <PageTabs
        tabs={[
          { id: "recibidos", label: "Recibidos" },
          { id: "archivados", label: "Archivados" },
        ]}
        current={tab}
        basePath={`/app/${orgId}/establishments/${estId}/messages`}
      />
      {tab === "recibidos" && unread > 0 && (
        <p className="notice">{unread === 1 ? "1 mensaje sin leer" : `${unread} mensajes sin leer`}</p>
      )}
      {messages.length === 0 ? (
        <p className="muted">{tab === "recibidos" ? "No hay mensajes." : "No hay mensajes archivados."}</p>
      ) : (
        <ul className="cards">
          {messages.map((m) => (
            <li key={m.id} className={m.status === "new" ? "message-new" : undefined}>
              <strong>{m.customerName}</strong>
              {m.status === "new" && <span className="badge badge-ok"> Nuevo</span>}
              {m.topic && <span className="badge"> {TOPIC_LABELS[m.topic]}</span>}
              <span className="muted"> · {when.format(m.createdAt)}</span>
              <div className="muted">
                {m.customerPhone && <a href={`tel:${m.customerPhone.replace(/[^0-9+]/g, "")}`}>{m.customerPhone}</a>}
                {m.customerPhone && m.customerEmail && " · "}
                {m.customerEmail && <a href={`mailto:${m.customerEmail}`}>{m.customerEmail}</a>}
              </div>
              <p className="message-text">{m.message}</p>
              <div className="inline-form">
                {m.status !== "archived" && (
                  <ActionForm
                    action={setMessageStatusAction.bind(null, orgId, estId, m.id, m.status === "new" ? "read" : "new")}
                    submitLabel={m.status === "new" ? "Marcar como leído" : "Marcar como no leído"}
                    submitAriaLabel={`${m.status === "new" ? "Marcar como leído" : "Marcar como no leído"} (${m.customerName})`}
                    className="inline-form"
                  />
                )}
                {canManage && m.status !== "archived" && (
                  <ActionForm
                    action={setMessageStatusAction.bind(null, orgId, estId, m.id, "archived")}
                    submitLabel="Archivar"
                    submitAriaLabel={`Archivar el mensaje de ${m.customerName}`}
                    className="inline-form"
                  />
                )}
                {canManage && m.status === "archived" && (
                  <ActionForm
                    action={setMessageStatusAction.bind(null, orgId, estId, m.id, "read")}
                    submitLabel="Recuperar"
                    submitAriaLabel={`Recuperar el mensaje de ${m.customerName}`}
                    className="inline-form"
                  />
                )}
                {canManage && (
                  <ActionForm
                    action={deleteMessageAction.bind(null, orgId, estId, m.id)}
                    submitLabel="Eliminar"
                    submitAriaLabel={`Eliminar el mensaje de ${m.customerName}`}
                    className="inline-form"
                  />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
