import type { PublicLanguage } from "./languages";

/**
 * Textos de la página pública de reserva en cada idioma (D-040). Los mensajes
 * de error del servidor se escriben en español y se traducen aquí (los que no
 * figuren se muestran en español).
 */
export interface BookingTexts {
  locale: string;
  pageTitle: (establishment: string) => string;
  eyebrow: string;
  searchLabel: string;
  date: string;
  party: string;
  seeTimes: string;
  groupsNote: (min: number, max: number) => string;
  people: (n: number) => string;
  noSlots: string;
  time: string;
  name: string;
  phone: string;
  email: string;
  contactNote: string;
  notes: string;
  notesPlaceholder: string;
  consent: (organization: string, days: number) => string;
  submit: string;
  sending: string;
  another: string;
  confirmed: string;
  pending: string;
  summary: (people: string, when: string, code: string) => string;
  /** Mensajes del servidor (en español) → este idioma. */
  errors: Record<string, string>;
  /** «Online se admiten de X a Y comensales». */
  partyRange: (min: number, max: number) => string;
  /** Cancelación por el cliente (D-041). */
  cancelLink: string;
  cancelNote: string;
  cancelTitle: string;
  cancelSummary: (code: string, people: string, when: string) => string;
  cancelButton: string;
  cancelConfirm: string;
  cancelled: string;
  alreadyCancelled: string;
  notCancellable: string;
  backToBooking: string;
  /** Lista de espera desde la web (D-042). */
  waitlistTitle: string;
  waitlistIntro: string;
  from: string;
  to: string;
  joinWaitlist: string;
  waitlistConsent: (organization: string, days: number) => string;
  joined: (people: string, date: string, from: string, to: string) => string;
}

export const BOOKING_TEXTS: Record<PublicLanguage, BookingTexts> = {
  es: {
    locale: "es-ES",
    pageTitle: (e) => `Reservar en ${e}`,
    eyebrow: "Reservas online",
    searchLabel: "Buscar disponibilidad",
    date: "Fecha",
    party: "Comensales",
    seeTimes: "Ver horas disponibles",
    groupsNote: (min, max) =>
      `Online se admiten grupos de ${min} a ${max} personas. Para grupos mayores, llama al restaurante.`,
    people: (n) => `${n} ${n === 1 ? "persona" : "personas"}`,
    noSlots: "No quedan horas disponibles online para ese día. Prueba otra fecha.",
    time: "Hora",
    name: "Nombre",
    phone: "Teléfono",
    email: "Correo",
    contactNote: "Indica al menos un teléfono o un correo.",
    notes: "Comentarios (opcional)",
    notesPlaceholder: "Alergias, trona, celebración…",
    consent: (org, days) =>
      `Acepto que ${org} trate estos datos únicamente para gestionar esta reserva y contactarme sobre ella. Se conservan ${days} días después de la reserva y después se anonimizan. Puedes pedir una copia o su borrado al restaurante.`,
    submit: "Reservar",
    sending: "Enviando…",
    another: "Hacer otra reserva",
    confirmed: "¡Reserva confirmada!",
    pending: "Solicitud recibida: el restaurante la revisará y te contactará para confirmarla.",
    summary: (people, when, code) =>
      `${people}, ${when}. Código de reserva: ${code}. Para otros cambios, contacta con el restaurante indicando este código.`,
    errors: {},
    partyRange: (min, max) => `Online se admiten de ${min} a ${max} comensales`,
    cancelLink: "Cancelar esta reserva",
    cancelNote: "Guarda este enlace: con él puedes cancelar la reserva sin llamar.",
    cancelTitle: "Cancelar reserva",
    cancelSummary: (code, people, when) => `Reserva ${code}: ${people}, ${when}.`,
    cancelButton: "Cancelar la reserva",
    cancelConfirm: "Si cancelas, la mesa quedará libre para otros clientes.",
    cancelled: "Reserva cancelada. Gracias por avisar.",
    alreadyCancelled: "Esta reserva ya estaba cancelada.",
    notCancellable: "Esta reserva ya no se puede cancelar online. Si necesitas algo, llama al restaurante.",
    backToBooking: "Hacer una reserva",
    waitlistTitle: "Apúntate a la lista de espera",
    waitlistIntro:
      "Si se libera una mesa en la franja que elijas, el restaurante te avisará por teléfono o correo. Apuntarte no garantiza mesa.",
    from: "Desde",
    to: "Hasta",
    joinWaitlist: "Apuntarme a la lista de espera",
    waitlistConsent: (org, days) =>
      `Acepto que ${org} trate estos datos únicamente para gestionar mi solicitud en la lista de espera y avisarme. Se conservan ${days} días después de la fecha y después se anonimizan. Puedes pedir una copia o su borrado al restaurante.`,
    joined: (people, date, from, to) =>
      `Te hemos apuntado a la lista de espera: ${people}, ${date}, de ${from} a ${to}. Si se libera una mesa, el restaurante te avisará.`,
  },
  en: {
    locale: "en-GB",
    pageTitle: (e) => `Book a table at ${e}`,
    eyebrow: "Online booking",
    searchLabel: "Check availability",
    date: "Date",
    party: "Guests",
    seeTimes: "See available times",
    groupsNote: (min, max) =>
      `Online bookings are for groups of ${min} to ${max} people. For larger groups, please call the restaurant.`,
    people: (n) => `${n} ${n === 1 ? "person" : "people"}`,
    noSlots: "There are no times left online for that day. Please try another date.",
    time: "Time",
    name: "Name",
    phone: "Phone",
    email: "Email",
    contactNote: "Please give at least a phone number or an email address.",
    notes: "Comments (optional)",
    notesPlaceholder: "Allergies, high chair, celebration…",
    consent: (org, days) =>
      `I agree that ${org} may process this data solely to manage this booking and contact me about it. It is kept for ${days} days after the booking and then anonymised. You can ask the restaurant for a copy or for its deletion.`,
    submit: "Book",
    sending: "Sending…",
    another: "Make another booking",
    confirmed: "Booking confirmed!",
    pending: "Request received: the restaurant will review it and contact you to confirm it.",
    summary: (people, when, code) =>
      `${people}, ${when}. Booking code: ${code}. For other changes, contact the restaurant quoting this code.`,
    errors: {
      "Hora no válida": "Invalid time",
      "La franja debe terminar después de empezar": "The time window must end after it starts",
      "Elige una fecha dentro de los días que admite el restaurante":
        "Choose a date within the days the restaurant accepts",
      "El restaurante no abre en esa franja": "The restaurant is not open in that time window",
      "Este establecimiento no acepta reservas online": "This restaurant does not take online bookings",
      "Número de comensales no admitido online": "That number of guests cannot be booked online",
      "Duración no válida": "Invalid duration",
      "Esa hora ya no se puede reservar online": "That time can no longer be booked online",
      "Esa hora acaba de completarse. Elige otra, por favor.": "That time has just filled up. Please choose another.",
      "Esa hora ya no está disponible. Elige otra, por favor.":
        "That time is no longer available. Please choose another.",
      "Demasiadas solicitudes. Inténtalo más tarde o llama al restaurante.":
        "Too many requests. Please try again later or call the restaurant.",
      "Tu solicitud ya se está procesando. Revisa en unos segundos.":
        "Your request is already being processed. Please check again in a few seconds.",
      "Datos no válidos": "Please check the details",
      "Fecha no válida": "Invalid date",
      "Elige una hora": "Choose a time",
      "Indica tu nombre": "Please enter your name",
      "Teléfono no válido": "Invalid phone number",
      "Correo no válido": "Invalid email address",
      "Debes aceptar el tratamiento de datos para gestionar la reserva":
        "You must accept the data processing to manage the booking",
      "No se pudo procesar la solicitud": "The request could not be processed",
      "Indica un teléfono o un correo para poder contactarte":
        "Please give a phone number or an email so we can contact you",
      "Se ha producido un error inesperado": "An unexpected error occurred",
    },
    partyRange: (min, max) => `Online bookings are for ${min} to ${max} guests`,
    cancelLink: "Cancel this booking",
    cancelNote: "Keep this link: you can use it to cancel the booking without calling.",
    cancelTitle: "Cancel booking",
    cancelSummary: (code, people, when) => `Booking ${code}: ${people}, ${when}.`,
    cancelButton: "Cancel the booking",
    cancelConfirm: "If you cancel, the table will be freed for other guests.",
    cancelled: "Booking cancelled. Thank you for letting us know.",
    alreadyCancelled: "This booking was already cancelled.",
    notCancellable: "This booking can no longer be cancelled online. If you need anything, please call the restaurant.",
    backToBooking: "Make a booking",
    waitlistTitle: "Join the waiting list",
    waitlistIntro:
      "If a table becomes free in the time window you choose, the restaurant will let you know by phone or email. Joining does not guarantee a table.",
    from: "From",
    to: "To",
    joinWaitlist: "Join the waiting list",
    waitlistConsent: (org, days) =>
      `I agree that ${org} may process this data solely to manage my waiting-list request and notify me. It is kept for ${days} days after the date and then anonymised. You can ask the restaurant for a copy or for its deletion.`,
    joined: (people, date, from, to) =>
      `You are on the waiting list: ${people}, ${date}, from ${from} to ${to}. If a table becomes free, the restaurant will let you know.`,
  },
  fr: {
    locale: "fr-FR",
    pageTitle: (e) => `Réserver chez ${e}`,
    eyebrow: "Réservation en ligne",
    searchLabel: "Voir les disponibilités",
    date: "Date",
    party: "Couverts",
    seeTimes: "Voir les horaires disponibles",
    groupsNote: (min, max) =>
      `En ligne, les groupes de ${min} à ${max} personnes sont acceptés. Pour les groupes plus nombreux, appelez le restaurant.`,
    people: (n) => `${n} ${n === 1 ? "personne" : "personnes"}`,
    noSlots: "Il n’y a plus d’horaires disponibles en ligne ce jour-là. Essayez une autre date.",
    time: "Heure",
    name: "Nom",
    phone: "Téléphone",
    email: "E-mail",
    contactNote: "Indiquez au moins un téléphone ou un e-mail.",
    notes: "Commentaires (facultatif)",
    notesPlaceholder: "Allergies, chaise haute, célébration…",
    consent: (org, days) =>
      `J’accepte que ${org} traite ces données uniquement pour gérer cette réservation et me contacter à son sujet. Elles sont conservées ${days} jours après la réservation, puis anonymisées. Vous pouvez en demander une copie ou leur suppression au restaurant.`,
    submit: "Réserver",
    sending: "Envoi…",
    another: "Faire une autre réservation",
    confirmed: "Réservation confirmée !",
    pending: "Demande reçue : le restaurant va l’examiner et vous contactera pour la confirmer.",
    summary: (people, when, code) =>
      `${people}, ${when}. Code de réservation : ${code}. Pour toute autre modification, contactez le restaurant en indiquant ce code.`,
    errors: {
      "Hora no válida": "Heure non valide",
      "La franja debe terminar después de empezar": "Le créneau doit se terminer après son début",
      "Elige una fecha dentro de los días que admite el restaurante":
        "Choisissez une date parmi les jours acceptés par le restaurant",
      "El restaurante no abre en esa franja": "Le restaurant n’est pas ouvert sur ce créneau",
      "Este establecimiento no acepta reservas online": "Ce restaurant n’accepte pas les réservations en ligne",
      "Número de comensales no admitido online": "Ce nombre de couverts n’est pas accepté en ligne",
      "Duración no válida": "Durée non valide",
      "Esa hora ya no se puede reservar online": "Cet horaire ne peut plus être réservé en ligne",
      "Esa hora acaba de completarse. Elige otra, por favor.":
        "Cet horaire vient d’être complet. Choisissez-en un autre.",
      "Esa hora ya no está disponible. Elige otra, por favor.":
        "Cet horaire n’est plus disponible. Choisissez-en un autre.",
      "Demasiadas solicitudes. Inténtalo más tarde o llama al restaurante.":
        "Trop de demandes. Réessayez plus tard ou appelez le restaurant.",
      "Tu solicitud ya se está procesando. Revisa en unos segundos.":
        "Votre demande est déjà en cours de traitement. Vérifiez dans quelques secondes.",
      "Datos no válidos": "Vérifiez les informations",
      "Fecha no válida": "Date non valide",
      "Elige una hora": "Choisissez un horaire",
      "Indica tu nombre": "Indiquez votre nom",
      "Teléfono no válido": "Téléphone non valide",
      "Correo no válido": "E-mail non valide",
      "Debes aceptar el tratamiento de datos para gestionar la reserva":
        "Vous devez accepter le traitement des données pour gérer la réservation",
      "No se pudo procesar la solicitud": "La demande n’a pas pu être traitée",
      "Indica un teléfono o un correo para poder contactarte":
        "Indiquez un téléphone ou un e-mail pour que nous puissions vous contacter",
      "Se ha producido un error inesperado": "Une erreur inattendue s’est produite",
    },
    partyRange: (min, max) => `En ligne, de ${min} à ${max} couverts`,
    cancelLink: "Annuler cette réservation",
    cancelNote: "Conservez ce lien : il vous permet d’annuler la réservation sans appeler.",
    cancelTitle: "Annuler la réservation",
    cancelSummary: (code, people, when) => `Réservation ${code} : ${people}, ${when}.`,
    cancelButton: "Annuler la réservation",
    cancelConfirm: "Si vous annulez, la table sera libérée pour d’autres clients.",
    cancelled: "Réservation annulée. Merci de nous avoir prévenus.",
    alreadyCancelled: "Cette réservation était déjà annulée.",
    notCancellable: "Cette réservation ne peut plus être annulée en ligne. Pour toute demande, appelez le restaurant.",
    backToBooking: "Faire une réservation",
    waitlistTitle: "Inscrivez-vous sur la liste d’attente",
    waitlistIntro:
      "Si une table se libère dans le créneau choisi, le restaurant vous préviendra par téléphone ou par e-mail. L’inscription ne garantit pas de table.",
    from: "De",
    to: "À",
    joinWaitlist: "M’inscrire sur la liste d’attente",
    waitlistConsent: (org, days) =>
      `J’accepte que ${org} traite ces données uniquement pour gérer ma demande sur la liste d’attente et me prévenir. Elles sont conservées ${days} jours après la date, puis anonymisées. Vous pouvez en demander une copie ou leur suppression au restaurant.`,
    joined: (people, date, from, to) =>
      `Vous êtes inscrit sur la liste d’attente : ${people}, ${date}, de ${from} à ${to}. Si une table se libère, le restaurant vous préviendra.`,
  },
  de: {
    locale: "de-DE",
    pageTitle: (e) => `Tisch reservieren bei ${e}`,
    eyebrow: "Online-Reservierung",
    searchLabel: "Verfügbarkeit prüfen",
    date: "Datum",
    party: "Personen",
    seeTimes: "Verfügbare Uhrzeiten anzeigen",
    groupsNote: (min, max) =>
      `Online sind Gruppen von ${min} bis ${max} Personen möglich. Für größere Gruppen rufen Sie bitte das Restaurant an.`,
    people: (n) => `${n} ${n === 1 ? "Person" : "Personen"}`,
    noSlots: "Für diesen Tag sind online keine Uhrzeiten mehr frei. Bitte wählen Sie ein anderes Datum.",
    time: "Uhrzeit",
    name: "Name",
    phone: "Telefon",
    email: "E-Mail",
    contactNote: "Bitte geben Sie mindestens eine Telefonnummer oder eine E-Mail-Adresse an.",
    notes: "Anmerkungen (optional)",
    notesPlaceholder: "Allergien, Kinderstuhl, Feier…",
    consent: (org, days) =>
      `Ich bin damit einverstanden, dass ${org} diese Daten ausschließlich zur Bearbeitung dieser Reservierung und zur Kontaktaufnahme dazu verarbeitet. Sie werden ${days} Tage nach der Reservierung aufbewahrt und danach anonymisiert. Sie können beim Restaurant eine Kopie oder die Löschung verlangen.`,
    submit: "Reservieren",
    sending: "Wird gesendet…",
    another: "Weitere Reservierung",
    confirmed: "Reservierung bestätigt!",
    pending: "Anfrage erhalten: Das Restaurant prüft sie und meldet sich zur Bestätigung.",
    summary: (people, when, code) =>
      `${people}, ${when}. Reservierungscode: ${code}. Für andere Änderungen wenden Sie sich bitte unter Angabe dieses Codes an das Restaurant.`,
    errors: {
      "Hora no válida": "Ungültige Uhrzeit",
      "La franja debe terminar después de empezar": "Der Zeitraum muss nach seinem Beginn enden",
      "Elige una fecha dentro de los días que admite el restaurante":
        "Wählen Sie ein Datum innerhalb der Tage, die das Restaurant annimmt",
      "El restaurante no abre en esa franja": "Das Restaurant ist in diesem Zeitraum nicht geöffnet",
      "Este establecimiento no acepta reservas online": "Dieses Restaurant nimmt keine Online-Reservierungen an",
      "Número de comensales no admitido online": "Diese Personenzahl ist online nicht möglich",
      "Duración no válida": "Ungültige Dauer",
      "Esa hora ya no se puede reservar online": "Diese Uhrzeit kann online nicht mehr reserviert werden",
      "Esa hora acaba de completarse. Elige otra, por favor.":
        "Diese Uhrzeit ist gerade ausgebucht. Bitte wählen Sie eine andere.",
      "Esa hora ya no está disponible. Elige otra, por favor.":
        "Diese Uhrzeit ist nicht mehr verfügbar. Bitte wählen Sie eine andere.",
      "Demasiadas solicitudes. Inténtalo más tarde o llama al restaurante.":
        "Zu viele Anfragen. Bitte versuchen Sie es später oder rufen Sie das Restaurant an.",
      "Tu solicitud ya se está procesando. Revisa en unos segundos.":
        "Ihre Anfrage wird bereits bearbeitet. Bitte prüfen Sie es in ein paar Sekunden erneut.",
      "Datos no válidos": "Bitte prüfen Sie die Angaben",
      "Fecha no válida": "Ungültiges Datum",
      "Elige una hora": "Wählen Sie eine Uhrzeit",
      "Indica tu nombre": "Bitte geben Sie Ihren Namen an",
      "Teléfono no válido": "Ungültige Telefonnummer",
      "Correo no válido": "Ungültige E-Mail-Adresse",
      "Debes aceptar el tratamiento de datos para gestionar la reserva":
        "Sie müssen der Datenverarbeitung zustimmen, damit die Reservierung bearbeitet werden kann",
      "No se pudo procesar la solicitud": "Die Anfrage konnte nicht bearbeitet werden",
      "Indica un teléfono o un correo para poder contactarte":
        "Bitte geben Sie eine Telefonnummer oder eine E-Mail-Adresse für Rückfragen an",
      "Se ha producido un error inesperado": "Ein unerwarteter Fehler ist aufgetreten",
    },
    partyRange: (min, max) => `Online sind ${min} bis ${max} Personen möglich`,
    cancelLink: "Diese Reservierung stornieren",
    cancelNote: "Bewahren Sie diesen Link auf: Damit können Sie die Reservierung ohne Anruf stornieren.",
    cancelTitle: "Reservierung stornieren",
    cancelSummary: (code, people, when) => `Reservierung ${code}: ${people}, ${when}.`,
    cancelButton: "Reservierung stornieren",
    cancelConfirm: "Wenn Sie stornieren, wird der Tisch für andere Gäste frei.",
    cancelled: "Reservierung storniert. Danke für Ihre Nachricht.",
    alreadyCancelled: "Diese Reservierung war bereits storniert.",
    notCancellable:
      "Diese Reservierung kann online nicht mehr storniert werden. Bitte rufen Sie bei Fragen das Restaurant an.",
    backToBooking: "Reservieren",
    waitlistTitle: "Auf die Warteliste setzen",
    waitlistIntro:
      "Wenn im gewählten Zeitraum ein Tisch frei wird, meldet sich das Restaurant telefonisch oder per E-Mail. Ein Platz auf der Warteliste garantiert keinen Tisch.",
    from: "Von",
    to: "Bis",
    joinWaitlist: "Auf die Warteliste setzen",
    waitlistConsent: (org, days) =>
      `Ich bin damit einverstanden, dass ${org} diese Daten ausschließlich zur Bearbeitung meiner Wartelisten-Anfrage und zur Benachrichtigung verarbeitet. Sie werden ${days} Tage nach dem Datum aufbewahrt und danach anonymisiert. Sie können beim Restaurant eine Kopie oder die Löschung verlangen.`,
    joined: (people, date, from, to) =>
      `Sie stehen auf der Warteliste: ${people}, ${date}, von ${from} bis ${to}. Wenn ein Tisch frei wird, meldet sich das Restaurant.`,
  },
  it: {
    locale: "it-IT",
    pageTitle: (e) => `Prenota da ${e}`,
    eyebrow: "Prenotazioni online",
    searchLabel: "Verifica disponibilità",
    date: "Data",
    party: "Persone",
    seeTimes: "Vedi orari disponibili",
    groupsNote: (min, max) =>
      `Online si accettano gruppi da ${min} a ${max} persone. Per gruppi più numerosi, chiama il ristorante.`,
    people: (n) => `${n} ${n === 1 ? "persona" : "persone"}`,
    noSlots: "Non ci sono più orari disponibili online per quel giorno. Prova un’altra data.",
    time: "Orario",
    name: "Nome",
    phone: "Telefono",
    email: "E-mail",
    contactNote: "Indica almeno un telefono o un’e-mail.",
    notes: "Note (facoltativo)",
    notesPlaceholder: "Allergie, seggiolone, festeggiamento…",
    consent: (org, days) =>
      `Accetto che ${org} tratti questi dati esclusivamente per gestire questa prenotazione e contattarmi al riguardo. Sono conservati per ${days} giorni dopo la prenotazione e poi anonimizzati. Puoi chiederne una copia o la cancellazione al ristorante.`,
    submit: "Prenota",
    sending: "Invio in corso…",
    another: "Fai un’altra prenotazione",
    confirmed: "Prenotazione confermata!",
    pending: "Richiesta ricevuta: il ristorante la esaminerà e ti contatterà per confermarla.",
    summary: (people, when, code) =>
      `${people}, ${when}. Codice di prenotazione: ${code}. Per altre modifiche, contatta il ristorante indicando questo codice.`,
    errors: {
      "Hora no válida": "Orario non valido",
      "La franja debe terminar después de empezar": "La fascia deve terminare dopo l’inizio",
      "Elige una fecha dentro de los días que admite el restaurante":
        "Scegli una data tra i giorni accettati dal ristorante",
      "El restaurante no abre en esa franja": "Il ristorante non è aperto in quella fascia",
      "Este establecimiento no acepta reservas online": "Questo ristorante non accetta prenotazioni online",
      "Número de comensales no admitido online": "Questo numero di persone non è prenotabile online",
      "Duración no válida": "Durata non valida",
      "Esa hora ya no se puede reservar online": "Quell’orario non è più prenotabile online",
      "Esa hora acaba de completarse. Elige otra, por favor.": "Quell’orario si è appena esaurito. Scegline un altro.",
      "Esa hora ya no está disponible. Elige otra, por favor.":
        "Quell’orario non è più disponibile. Scegline un altro.",
      "Demasiadas solicitudes. Inténtalo más tarde o llama al restaurante.":
        "Troppe richieste. Riprova più tardi o chiama il ristorante.",
      "Tu solicitud ya se está procesando. Revisa en unos segundos.":
        "La tua richiesta è già in elaborazione. Ricontrolla tra qualche secondo.",
      "Datos no válidos": "Controlla i dati",
      "Fecha no válida": "Data non valida",
      "Elige una hora": "Scegli un orario",
      "Indica tu nombre": "Indica il tuo nome",
      "Teléfono no válido": "Telefono non valido",
      "Correo no válido": "E-mail non valida",
      "Debes aceptar el tratamiento de datos para gestionar la reserva":
        "Devi accettare il trattamento dei dati per gestire la prenotazione",
      "No se pudo procesar la solicitud": "Non è stato possibile elaborare la richiesta",
      "Indica un teléfono o un correo para poder contactarte": "Indica un telefono o un’e-mail per poterti contattare",
      "Se ha producido un error inesperado": "Si è verificato un errore imprevisto",
    },
    partyRange: (min, max) => `Online si accettano da ${min} a ${max} persone`,
    cancelLink: "Annulla questa prenotazione",
    cancelNote: "Conserva questo link: ti permette di annullare la prenotazione senza chiamare.",
    cancelTitle: "Annulla prenotazione",
    cancelSummary: (code, people, when) => `Prenotazione ${code}: ${people}, ${when}.`,
    cancelButton: "Annulla la prenotazione",
    cancelConfirm: "Se annulli, il tavolo sarà libero per altri clienti.",
    cancelled: "Prenotazione annullata. Grazie per averci avvisato.",
    alreadyCancelled: "Questa prenotazione era già annullata.",
    notCancellable:
      "Questa prenotazione non può più essere annullata online. Per qualsiasi cosa, chiama il ristorante.",
    backToBooking: "Fai una prenotazione",
    waitlistTitle: "Iscriviti alla lista d’attesa",
    waitlistIntro:
      "Se si libera un tavolo nella fascia che scegli, il ristorante ti avviserà per telefono o e-mail. L’iscrizione non garantisce un tavolo.",
    from: "Dalle",
    to: "Alle",
    joinWaitlist: "Iscrivimi alla lista d’attesa",
    waitlistConsent: (org, days) =>
      `Accetto che ${org} tratti questi dati esclusivamente per gestire la mia richiesta in lista d’attesa e avvisarmi. Sono conservati per ${days} giorni dopo la data e poi anonimizzati. Puoi chiederne una copia o la cancellazione al ristorante.`,
    joined: (people, date, from, to) =>
      `Sei in lista d’attesa: ${people}, ${date}, dalle ${from} alle ${to}. Se si libera un tavolo, il ristorante ti avviserà.`,
  },
  pt: {
    locale: "pt-PT",
    pageTitle: (e) => `Reservar em ${e}`,
    eyebrow: "Reservas online",
    searchLabel: "Ver disponibilidade",
    date: "Data",
    party: "Pessoas",
    seeTimes: "Ver horas disponíveis",
    groupsNote: (min, max) =>
      `Online aceitam-se grupos de ${min} a ${max} pessoas. Para grupos maiores, ligue para o restaurante.`,
    people: (n) => `${n} ${n === 1 ? "pessoa" : "pessoas"}`,
    noSlots: "Já não há horas disponíveis online para esse dia. Experimente outra data.",
    time: "Hora",
    name: "Nome",
    phone: "Telefone",
    email: "E-mail",
    contactNote: "Indique pelo menos um telefone ou um e-mail.",
    notes: "Comentários (opcional)",
    notesPlaceholder: "Alergias, cadeira de bebé, celebração…",
    consent: (org, days) =>
      `Aceito que ${org} trate estes dados apenas para gerir esta reserva e contactar-me sobre ela. São conservados durante ${days} dias após a reserva e depois anonimizados. Pode pedir uma cópia ou a sua eliminação ao restaurante.`,
    submit: "Reservar",
    sending: "A enviar…",
    another: "Fazer outra reserva",
    confirmed: "Reserva confirmada!",
    pending: "Pedido recebido: o restaurante vai analisá-lo e contactá-lo para o confirmar.",
    summary: (people, when, code) =>
      `${people}, ${when}. Código da reserva: ${code}. Para outras alterações, contacte o restaurante indicando este código.`,
    errors: {
      "Hora no válida": "Hora inválida",
      "La franja debe terminar después de empezar": "O intervalo deve terminar depois de começar",
      "Elige una fecha dentro de los días que admite el restaurante":
        "Escolha uma data dentro dos dias que o restaurante aceita",
      "El restaurante no abre en esa franja": "O restaurante não abre nesse intervalo",
      "Este establecimiento no acepta reservas online": "Este restaurante não aceita reservas online",
      "Número de comensales no admitido online": "Esse número de pessoas não é admitido online",
      "Duración no válida": "Duração inválida",
      "Esa hora ya no se puede reservar online": "Essa hora já não pode ser reservada online",
      "Esa hora acaba de completarse. Elige otra, por favor.": "Essa hora acabou de esgotar. Escolha outra, por favor.",
      "Esa hora ya no está disponible. Elige otra, por favor.":
        "Essa hora já não está disponível. Escolha outra, por favor.",
      "Demasiadas solicitudes. Inténtalo más tarde o llama al restaurante.":
        "Demasiados pedidos. Tente mais tarde ou ligue para o restaurante.",
      "Tu solicitud ya se está procesando. Revisa en unos segundos.":
        "O seu pedido já está a ser processado. Verifique dentro de alguns segundos.",
      "Datos no válidos": "Verifique os dados",
      "Fecha no válida": "Data inválida",
      "Elige una hora": "Escolha uma hora",
      "Indica tu nombre": "Indique o seu nome",
      "Teléfono no válido": "Telefone inválido",
      "Correo no válido": "E-mail inválido",
      "Debes aceptar el tratamiento de datos para gestionar la reserva":
        "Tem de aceitar o tratamento de dados para gerir a reserva",
      "No se pudo procesar la solicitud": "Não foi possível processar o pedido",
      "Indica un teléfono o un correo para poder contactarte":
        "Indique um telefone ou um e-mail para o podermos contactar",
      "Se ha producido un error inesperado": "Ocorreu um erro inesperado",
    },
    partyRange: (min, max) => `Online aceitam-se de ${min} a ${max} pessoas`,
    cancelLink: "Cancelar esta reserva",
    cancelNote: "Guarde este link: com ele pode cancelar a reserva sem ligar.",
    cancelTitle: "Cancelar reserva",
    cancelSummary: (code, people, when) => `Reserva ${code}: ${people}, ${when}.`,
    cancelButton: "Cancelar a reserva",
    cancelConfirm: "Se cancelar, a mesa ficará livre para outros clientes.",
    cancelled: "Reserva cancelada. Obrigado por avisar.",
    alreadyCancelled: "Esta reserva já estava cancelada.",
    notCancellable: "Esta reserva já não pode ser cancelada online. Se precisar de algo, ligue para o restaurante.",
    backToBooking: "Fazer uma reserva",
    waitlistTitle: "Inscreva-se na lista de espera",
    waitlistIntro:
      "Se ficar livre uma mesa no intervalo que escolher, o restaurante avisa-o por telefone ou e-mail. A inscrição não garante mesa.",
    from: "Das",
    to: "Até",
    joinWaitlist: "Inscrever-me na lista de espera",
    waitlistConsent: (org, days) =>
      `Aceito que ${org} trate estes dados apenas para gerir o meu pedido na lista de espera e avisar-me. São conservados durante ${days} dias após a data e depois anonimizados. Pode pedir uma cópia ou a sua eliminação ao restaurante.`,
    joined: (people, date, from, to) =>
      `Ficou inscrito na lista de espera: ${people}, ${date}, das ${from} às ${to}. Se ficar livre uma mesa, o restaurante avisa-o.`,
  },
  ca: {
    locale: "ca-ES",
    pageTitle: (e) => `Reserva a ${e}`,
    eyebrow: "Reserves en línia",
    searchLabel: "Consulta la disponibilitat",
    date: "Data",
    party: "Comensals",
    seeTimes: "Mostra les hores disponibles",
    groupsNote: (min, max) =>
      `En línia s’admeten grups de ${min} a ${max} persones. Per a grups més grans, truca al restaurant.`,
    people: (n) => `${n} ${n === 1 ? "persona" : "persones"}`,
    noSlots: "Ja no queden hores disponibles en línia per a aquell dia. Prova una altra data.",
    time: "Hora",
    name: "Nom",
    phone: "Telèfon",
    email: "Correu",
    contactNote: "Indica com a mínim un telèfon o un correu.",
    notes: "Comentaris (opcional)",
    notesPlaceholder: "Al·lèrgies, trona, celebració…",
    consent: (org, days) =>
      `Accepto que ${org} tracti aquestes dades únicament per gestionar aquesta reserva i contactar-me sobre ella. Es conserven ${days} dies després de la reserva i després s’anonimitzen. Pots demanar-ne una còpia o l’esborrament al restaurant.`,
    submit: "Reserva",
    sending: "S’està enviant…",
    another: "Fes una altra reserva",
    confirmed: "Reserva confirmada!",
    pending: "Sol·licitud rebuda: el restaurant la revisarà i et contactarà per confirmar-la.",
    summary: (people, when, code) =>
      `${people}, ${when}. Codi de reserva: ${code}. Per a altres canvis, contacta amb el restaurant indicant aquest codi.`,
    errors: {
      "Hora no válida": "Hora no vàlida",
      "La franja debe terminar después de empezar": "La franja ha d’acabar després de començar",
      "Elige una fecha dentro de los días que admite el restaurante":
        "Tria una data dins dels dies que admet el restaurant",
      "El restaurante no abre en esa franja": "El restaurant no obre en aquesta franja",
      "Este establecimiento no acepta reservas online": "Aquest restaurant no accepta reserves en línia",
      "Número de comensales no admitido online": "Aquest nombre de comensals no s’admet en línia",
      "Duración no válida": "Durada no vàlida",
      "Esa hora ya no se puede reservar online": "Aquesta hora ja no es pot reservar en línia",
      "Esa hora acaba de completarse. Elige otra, por favor.":
        "Aquesta hora s’acaba d’omplir. Tria’n una altra, si us plau.",
      "Esa hora ya no está disponible. Elige otra, por favor.":
        "Aquesta hora ja no està disponible. Tria’n una altra, si us plau.",
      "Demasiadas solicitudes. Inténtalo más tarde o llama al restaurante.":
        "Massa sol·licituds. Torna-ho a provar més tard o truca al restaurant.",
      "Tu solicitud ya se está procesando. Revisa en unos segundos.":
        "La teva sol·licitud ja s’està processant. Revisa-ho d’aquí a uns segons.",
      "Datos no válidos": "Revisa les dades",
      "Fecha no válida": "Data no vàlida",
      "Elige una hora": "Tria una hora",
      "Indica tu nombre": "Indica el teu nom",
      "Teléfono no válido": "Telèfon no vàlid",
      "Correo no válido": "Correu no vàlid",
      "Debes aceptar el tratamiento de datos para gestionar la reserva":
        "Has d’acceptar el tractament de dades per gestionar la reserva",
      "No se pudo procesar la solicitud": "No s’ha pogut processar la sol·licitud",
      "Indica un teléfono o un correo para poder contactarte":
        "Indica un telèfon o un correu perquè et puguem contactar",
      "Se ha producido un error inesperado": "S’ha produït un error inesperat",
    },
    partyRange: (min, max) => `En línia s’admeten de ${min} a ${max} comensals`,
    cancelLink: "Cancel·la aquesta reserva",
    cancelNote: "Desa aquest enllaç: et permet cancel·lar la reserva sense trucar.",
    cancelTitle: "Cancel·la la reserva",
    cancelSummary: (code, people, when) => `Reserva ${code}: ${people}, ${when}.`,
    cancelButton: "Cancel·la la reserva",
    cancelConfirm: "Si cancel·les, la taula quedarà lliure per a altres clients.",
    cancelled: "Reserva cancel·lada. Gràcies per avisar.",
    alreadyCancelled: "Aquesta reserva ja estava cancel·lada.",
    notCancellable: "Aquesta reserva ja no es pot cancel·lar en línia. Si necessites alguna cosa, truca al restaurant.",
    backToBooking: "Fes una reserva",
    waitlistTitle: "Apunta’t a la llista d’espera",
    waitlistIntro:
      "Si s’allibera una taula en la franja que triïs, el restaurant t’avisarà per telèfon o correu. Apuntar-t’hi no garanteix taula.",
    from: "Des de",
    to: "Fins a",
    joinWaitlist: "Apunta’m a la llista d’espera",
    waitlistConsent: (org, days) =>
      `Accepto que ${org} tracti aquestes dades únicament per gestionar la meva sol·licitud a la llista d’espera i avisar-me. Es conserven ${days} dies després de la data i després s’anonimitzen. Pots demanar-ne una còpia o l’esborrament al restaurant.`,
    joined: (people, date, from, to) =>
      `T’hem apuntat a la llista d’espera: ${people}, ${date}, de ${from} a ${to}. Si s’allibera una taula, el restaurant t’avisarà.`,
  },
};

const PARTY_RANGE = /^Online se admiten de (\d+) a (\d+) comensales$/;

/** Mensaje del servidor (en español) en `lang`; si no se conoce, se deja en español. */
export function translateBookingMessage(message: string, lang: PublicLanguage): string {
  const t = BOOKING_TEXTS[lang];
  const range = PARTY_RANGE.exec(message);
  if (range) return t.partyRange(Number(range[1]), Number(range[2]));
  return t.errors[message] ?? message;
}
