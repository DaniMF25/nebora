/** Estado de la búsqueda de datos de un cliente (compartido cliente/servidor). */
export interface LookupState {
  contact?: string;
  results?: {
    id: string;
    when: string;
    establishment: string;
    partySize: number;
    status: string;
    channel: string;
    name: string;
    phone: string | null;
    email: string | null;
  }[];
  error?: string;
  message?: string;
}
