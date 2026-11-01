/** Estado devuelto por las Server Actions a los formularios (compartido cliente/servidor). */
export interface FormState {
  error?: string;
  fieldErrors?: Record<string, string[]>;
  ok?: boolean;
  /** Mensaje de éxito opcional. */
  message?: string;
  /** Ruta de invitación generada (se muestra una sola vez a quien invita). */
  invitePath?: string;
  /** Enlace de cancelación de una reserva online (se muestra una sola vez al cliente). */
  cancelPath?: string;
}
