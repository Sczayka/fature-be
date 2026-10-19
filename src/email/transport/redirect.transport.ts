import type { EmailMessage } from '../email.types.js';
import {
  EmailTransport,
  SendEmailOptions,
  SentEmail,
} from './email-transport.js';

/** Desenvolvimento e homologação: todo e-mail vai para um endereço só; o assunto guarda o original. */
export class RedirectTransport implements EmailTransport {
  readonly name: string;

  constructor(
    private readonly inner: EmailTransport,
    private readonly redirectTo: string,
  ) {
    this.name = `${inner.name}-redirect`;
  }

  send(message: EmailMessage, options: SendEmailOptions): Promise<SentEmail> {
    return this.inner.send(
      {
        ...message,
        to: this.redirectTo,
        subject: `[para ${message.to}] ${message.subject}`,
      },
      options,
    );
  }
}
