import type { PublicLanguage } from "./languages";

/**
 * Textos de la página de contacto y su formulario en cada idioma (D-049). Los
 * mensajes de error del servidor se escriben en español y se traducen aquí
 * (los que no figuren se muestran en español). Las traducciones las ha
 * redactado el equipo de desarrollo: conviene que las revise un hablante nativo.
 */
export interface ContactTexts {
  pageTitle: (establishment: string) => string;
  intro: string;
  formTitle: string;
  name: string;
  phone: string;
  email: string;
  contactNote: string;
  message: string;
  messagePlaceholder: string;
  consent: (organization: string, days: number) => string;
  submit: string;
  sending: string;
  sent: string;
  another: string;
  /** Mensajes del servidor (en español) → este idioma. */
  errors: Record<string, string>;
}

/** Mensajes del servidor que pueden llegar al visitante (los traduce cada idioma). */
export const CONTACT_SERVER_MESSAGES = [
  "Indica tu nombre",
  "Teléfono no válido",
  "Correo no válido",
  "Escribe tu mensaje",
  "El mensaje no puede superar 2000 caracteres",
  "Debes aceptar el tratamiento de datos para que podamos responderte",
  "No se pudo procesar la solicitud",
  "Indica un teléfono o un correo para poder responderte",
  "Demasiados mensajes. Inténtalo más tarde o llama al restaurante.",
  "Este restaurante no recibe mensajes desde la web",
  "Tu mensaje ya se está enviando. Revisa en unos segundos.",
  "Datos no válidos",
  "Se ha producido un error inesperado",
] as const;

type Errors = Record<(typeof CONTACT_SERVER_MESSAGES)[number], string>;

const es: ContactTexts = {
  pageTitle: (e) => `Contacto · ${e}`,
  intro: "¿Una pregunta, un evento o una celebración? Escríbenos y te responderemos lo antes posible.",
  formTitle: "Escríbenos",
  name: "Nombre",
  phone: "Teléfono",
  email: "Correo electrónico",
  contactNote: "Indica un teléfono o un correo para poder responderte.",
  message: "Mensaje",
  messagePlaceholder: "Cuéntanos en qué podemos ayudarte",
  consent: (org, days) =>
    `Acepto que ${org} trate estos datos únicamente para responder a mi mensaje. Se conservan ${days} días y después se anonimizan. Puedes pedir una copia o su borrado al restaurante.`,
  submit: "Enviar mensaje",
  sending: "Enviando…",
  sent: "Mensaje enviado. Te responderemos lo antes posible.",
  another: "Enviar otro mensaje",
  errors: Object.fromEntries(CONTACT_SERVER_MESSAGES.map((m) => [m, m])) as Errors,
};

const en: ContactTexts = {
  pageTitle: (e) => `Contact · ${e}`,
  intro: "A question, an event or a celebration? Write to us and we will get back to you as soon as possible.",
  formTitle: "Write to us",
  name: "Name",
  phone: "Phone",
  email: "Email",
  contactNote: "Give us a phone number or an email so we can reply.",
  message: "Message",
  messagePlaceholder: "Tell us how we can help",
  consent: (org, days) =>
    `I agree that ${org} may process this data solely to reply to my message. It is kept for ${days} days and then anonymised. You can ask the restaurant for a copy or for its deletion.`,
  submit: "Send message",
  sending: "Sending…",
  sent: "Message sent. We will get back to you as soon as possible.",
  another: "Send another message",
  errors: {
    "Indica tu nombre": "Enter your name",
    "Teléfono no válido": "Invalid phone number",
    "Correo no válido": "Invalid email",
    "Escribe tu mensaje": "Write your message",
    "El mensaje no puede superar 2000 caracteres": "The message cannot exceed 2000 characters",
    "Debes aceptar el tratamiento de datos para que podamos responderte":
      "You must accept the data processing so that we can reply",
    "No se pudo procesar la solicitud": "The request could not be processed",
    "Indica un teléfono o un correo para poder responderte": "Give us a phone number or an email so we can reply",
    "Demasiados mensajes. Inténtalo más tarde o llama al restaurante.":
      "Too many messages. Try again later or call the restaurant.",
    "Este restaurante no recibe mensajes desde la web": "This restaurant does not receive messages from the website",
    "Tu mensaje ya se está enviando. Revisa en unos segundos.":
      "Your message is already being sent. Check again in a few seconds.",
    "Datos no válidos": "Invalid data",
    "Se ha producido un error inesperado": "An unexpected error occurred",
  },
};

const fr: ContactTexts = {
  pageTitle: (e) => `Contact · ${e}`,
  intro: "Une question, un événement ou une célébration ? Écrivez-nous et nous vous répondrons au plus vite.",
  formTitle: "Écrivez-nous",
  name: "Nom",
  phone: "Téléphone",
  email: "E-mail",
  contactNote: "Indiquez un téléphone ou un e-mail pour que nous puissions vous répondre.",
  message: "Message",
  messagePlaceholder: "Dites-nous comment nous pouvons vous aider",
  consent: (org, days) =>
    `J'accepte que ${org} traite ces données uniquement pour répondre à mon message. Elles sont conservées ${days} jours puis anonymisées. Vous pouvez en demander une copie ou leur suppression au restaurant.`,
  submit: "Envoyer le message",
  sending: "Envoi…",
  sent: "Message envoyé. Nous vous répondrons au plus vite.",
  another: "Envoyer un autre message",
  errors: {
    "Indica tu nombre": "Indiquez votre nom",
    "Teléfono no válido": "Téléphone non valide",
    "Correo no válido": "E-mail non valide",
    "Escribe tu mensaje": "Écrivez votre message",
    "El mensaje no puede superar 2000 caracteres": "Le message ne peut pas dépasser 2000 caractères",
    "Debes aceptar el tratamiento de datos para que podamos responderte":
      "Vous devez accepter le traitement des données pour que nous puissions vous répondre",
    "No se pudo procesar la solicitud": "La demande n'a pas pu être traitée",
    "Indica un teléfono o un correo para poder responderte":
      "Indiquez un téléphone ou un e-mail pour que nous puissions vous répondre",
    "Demasiados mensajes. Inténtalo más tarde o llama al restaurante.":
      "Trop de messages. Réessayez plus tard ou appelez le restaurant.",
    "Este restaurante no recibe mensajes desde la web": "Ce restaurant ne reçoit pas de messages depuis le site",
    "Tu mensaje ya se está enviando. Revisa en unos segundos.":
      "Votre message est déjà en cours d'envoi. Vérifiez dans quelques secondes.",
    "Datos no válidos": "Données non valides",
    "Se ha producido un error inesperado": "Une erreur inattendue s'est produite",
  },
};

const de: ContactTexts = {
  pageTitle: (e) => `Kontakt · ${e}`,
  intro: "Eine Frage, eine Veranstaltung oder eine Feier? Schreiben Sie uns, wir antworten so schnell wie möglich.",
  formTitle: "Schreiben Sie uns",
  name: "Name",
  phone: "Telefon",
  email: "E-Mail",
  contactNote: "Geben Sie eine Telefonnummer oder E-Mail an, damit wir antworten können.",
  message: "Nachricht",
  messagePlaceholder: "Wie können wir Ihnen helfen?",
  consent: (org, days) =>
    `Ich bin damit einverstanden, dass ${org} diese Daten ausschließlich zur Beantwortung meiner Nachricht verarbeitet. Sie werden ${days} Tage aufbewahrt und danach anonymisiert. Sie können beim Restaurant eine Kopie oder die Löschung verlangen.`,
  submit: "Nachricht senden",
  sending: "Wird gesendet…",
  sent: "Nachricht gesendet. Wir antworten so schnell wie möglich.",
  another: "Weitere Nachricht senden",
  errors: {
    "Indica tu nombre": "Geben Sie Ihren Namen an",
    "Teléfono no válido": "Ungültige Telefonnummer",
    "Correo no válido": "Ungültige E-Mail",
    "Escribe tu mensaje": "Schreiben Sie Ihre Nachricht",
    "El mensaje no puede superar 2000 caracteres": "Die Nachricht darf 2000 Zeichen nicht überschreiten",
    "Debes aceptar el tratamiento de datos para que podamos responderte":
      "Sie müssen der Datenverarbeitung zustimmen, damit wir antworten können",
    "No se pudo procesar la solicitud": "Die Anfrage konnte nicht verarbeitet werden",
    "Indica un teléfono o un correo para poder responderte":
      "Geben Sie eine Telefonnummer oder E-Mail an, damit wir antworten können",
    "Demasiados mensajes. Inténtalo más tarde o llama al restaurante.":
      "Zu viele Nachrichten. Versuchen Sie es später erneut oder rufen Sie das Restaurant an.",
    "Este restaurante no recibe mensajes desde la web": "Dieses Restaurant empfängt keine Nachrichten über die Website",
    "Tu mensaje ya se está enviando. Revisa en unos segundos.":
      "Ihre Nachricht wird bereits gesendet. Prüfen Sie es in ein paar Sekunden.",
    "Datos no válidos": "Ungültige Daten",
    "Se ha producido un error inesperado": "Ein unerwarteter Fehler ist aufgetreten",
  },
};

const it: ContactTexts = {
  pageTitle: (e) => `Contatti · ${e}`,
  intro: "Una domanda, un evento o una festa? Scrivici e ti risponderemo il prima possibile.",
  formTitle: "Scrivici",
  name: "Nome",
  phone: "Telefono",
  email: "E-mail",
  contactNote: "Indica un telefono o un'e-mail per poterti rispondere.",
  message: "Messaggio",
  messagePlaceholder: "Raccontaci come possiamo aiutarti",
  consent: (org, days) =>
    `Accetto che ${org} tratti questi dati solo per rispondere al mio messaggio. Sono conservati per ${days} giorni e poi resi anonimi. Puoi chiedere al ristorante una copia o la loro cancellazione.`,
  submit: "Invia messaggio",
  sending: "Invio…",
  sent: "Messaggio inviato. Ti risponderemo il prima possibile.",
  another: "Invia un altro messaggio",
  errors: {
    "Indica tu nombre": "Indica il tuo nome",
    "Teléfono no válido": "Telefono non valido",
    "Correo no válido": "E-mail non valida",
    "Escribe tu mensaje": "Scrivi il tuo messaggio",
    "El mensaje no puede superar 2000 caracteres": "Il messaggio non può superare 2000 caratteri",
    "Debes aceptar el tratamiento de datos para que podamos responderte":
      "Devi accettare il trattamento dei dati per poterti rispondere",
    "No se pudo procesar la solicitud": "Non è stato possibile elaborare la richiesta",
    "Indica un teléfono o un correo para poder responderte": "Indica un telefono o un'e-mail per poterti rispondere",
    "Demasiados mensajes. Inténtalo más tarde o llama al restaurante.":
      "Troppi messaggi. Riprova più tardi o chiama il ristorante.",
    "Este restaurante no recibe mensajes desde la web": "Questo ristorante non riceve messaggi dal sito",
    "Tu mensaje ya se está enviando. Revisa en unos segundos.":
      "Il tuo messaggio è già in invio. Controlla tra qualche secondo.",
    "Datos no válidos": "Dati non validi",
    "Se ha producido un error inesperado": "Si è verificato un errore imprevisto",
  },
};

const pt: ContactTexts = {
  pageTitle: (e) => `Contacto · ${e}`,
  intro: "Uma pergunta, um evento ou uma celebração? Escreva-nos e responderemos o mais depressa possível.",
  formTitle: "Escreva-nos",
  name: "Nome",
  phone: "Telefone",
  email: "E-mail",
  contactNote: "Indique um telefone ou um e-mail para lhe podermos responder.",
  message: "Mensagem",
  messagePlaceholder: "Diga-nos como podemos ajudar",
  consent: (org, days) =>
    `Aceito que ${org} trate estes dados apenas para responder à minha mensagem. São conservados ${days} dias e depois anonimizados. Pode pedir ao restaurante uma cópia ou a sua eliminação.`,
  submit: "Enviar mensagem",
  sending: "A enviar…",
  sent: "Mensagem enviada. Responderemos o mais depressa possível.",
  another: "Enviar outra mensagem",
  errors: {
    "Indica tu nombre": "Indique o seu nome",
    "Teléfono no válido": "Telefone inválido",
    "Correo no válido": "E-mail inválido",
    "Escribe tu mensaje": "Escreva a sua mensagem",
    "El mensaje no puede superar 2000 caracteres": "A mensagem não pode ter mais de 2000 caracteres",
    "Debes aceptar el tratamiento de datos para que podamos responderte":
      "Tem de aceitar o tratamento de dados para lhe podermos responder",
    "No se pudo procesar la solicitud": "Não foi possível processar o pedido",
    "Indica un teléfono o un correo para poder responderte":
      "Indique um telefone ou um e-mail para lhe podermos responder",
    "Demasiados mensajes. Inténtalo más tarde o llama al restaurante.":
      "Demasiadas mensagens. Tente mais tarde ou ligue para o restaurante.",
    "Este restaurante no recibe mensajes desde la web": "Este restaurante não recebe mensagens pelo site",
    "Tu mensaje ya se está enviando. Revisa en unos segundos.":
      "A sua mensagem já está a ser enviada. Verifique dentro de alguns segundos.",
    "Datos no válidos": "Dados inválidos",
    "Se ha producido un error inesperado": "Ocorreu um erro inesperado",
  },
};

const ca: ContactTexts = {
  pageTitle: (e) => `Contacte · ${e}`,
  intro: "Una pregunta, un esdeveniment o una celebració? Escriu-nos i et respondrem com més aviat millor.",
  formTitle: "Escriu-nos",
  name: "Nom",
  phone: "Telèfon",
  email: "Correu electrònic",
  contactNote: "Indica un telèfon o un correu perquè et puguem respondre.",
  message: "Missatge",
  messagePlaceholder: "Explica'ns com et podem ajudar",
  consent: (org, days) =>
    `Accepto que ${org} tracti aquestes dades únicament per respondre al meu missatge. Es conserven ${days} dies i després s'anonimitzen. Pots demanar-ne una còpia o l'esborrament al restaurant.`,
  submit: "Envia el missatge",
  sending: "S'està enviant…",
  sent: "Missatge enviat. Et respondrem com més aviat millor.",
  another: "Envia un altre missatge",
  errors: {
    "Indica tu nombre": "Indica el teu nom",
    "Teléfono no válido": "Telèfon no vàlid",
    "Correo no válido": "Correu no vàlid",
    "Escribe tu mensaje": "Escriu el teu missatge",
    "El mensaje no puede superar 2000 caracteres": "El missatge no pot superar 2000 caràcters",
    "Debes aceptar el tratamiento de datos para que podamos responderte":
      "Has d'acceptar el tractament de dades perquè et puguem respondre",
    "No se pudo procesar la solicitud": "No s'ha pogut processar la sol·licitud",
    "Indica un teléfono o un correo para poder responderte": "Indica un telèfon o un correu perquè et puguem respondre",
    "Demasiados mensajes. Inténtalo más tarde o llama al restaurante.":
      "Massa missatges. Torna-ho a provar més tard o truca al restaurant.",
    "Este restaurante no recibe mensajes desde la web": "Aquest restaurant no rep missatges des del web",
    "Tu mensaje ya se está enviando. Revisa en unos segundos.":
      "El teu missatge ja s'està enviant. Comprova-ho d'aquí a uns segons.",
    "Datos no válidos": "Dades no vàlides",
    "Se ha producido un error inesperado": "S'ha produït un error inesperat",
  },
};

export const CONTACT_TEXTS: Record<PublicLanguage, ContactTexts> = { es, en, fr, de, it, pt, ca };

/** Traduce un mensaje del servidor; si no está en el diccionario, se queda en español. */
export function translateContactMessage(message: string, lang: PublicLanguage): string {
  return CONTACT_TEXTS[lang].errors[message] ?? message;
}
