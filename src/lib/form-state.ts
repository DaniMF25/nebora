/** Estado devuelto por las Server Actions a los formularios (compartido cliente/servidor). */
export interface FormState {
  error?: string;
  fieldErrors?: Record<string, string[]>;
  ok?: boolean;
}
