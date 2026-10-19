import type { EmailMessage } from '../email.types.js';

export const EMAIL_TRANSPORT = Symbol('EMAIL_TRANSPORT');

export interface SendEmailOptions {
  /** A mesma chave em uma nova tentativa não gera um segundo e-mail no provedor. */
  idempotencyKey: string;
}

export interface SentEmail {
  providerMessageId: string | null;
}

export interface EmailTransport {
  readonly name: string;
  send(message: EmailMessage, options: SendEmailOptions): Promise<SentEmail>;
}

/** Falha de envio; `message` em pt-BR, exibida no registro do e-mail. */
export class EmailDeliveryError extends Error {
  constructor(
    message: string,
    /** Permanente: tentar de novo não resolve (ex.: endereço recusado). */
    readonly permanent: boolean,
  ) {
    super(message);
    this.name = 'EmailDeliveryError';
  }
}
