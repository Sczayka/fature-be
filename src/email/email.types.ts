import type { EmailSource, EmailType } from './email.constants.js';

/** Conteúdo pronto de um e-mail: o texto puro acompanha o HTML (clientes sem HTML e antispam). */
export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export interface EmailMessage {
  from: string;
  to: string;
  replyTo: string | null;
  subject: string;
  html: string;
  text: string;
  /** Rótulos para filtrar no painel do provedor (letras, números, _ e -). */
  tags: Record<string, string>;
}

/** Vínculos e origem de um e-mail ao pagador. */
export interface EmailReference {
  organizationId: string;
  clientId: string | null;
  invoiceId: string | null;
  invoiceDraftId: string | null;
  type: EmailType;
  source: EmailSource;
  requestedBy: string | null;
  /** Automáticos: impede repetir o mesmo aviso; null nos envios manuais. */
  dedupeKey: string | null;
}

export interface EnqueueEmailInput extends EmailReference {
  recipient: string;
  sender: string;
  replyTo: string | null;
  content: RenderedEmail;
}

export interface SkippedEmailInput extends EmailReference {
  sender: string;
  subject: string;
  reason: string;
}
