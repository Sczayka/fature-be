import { Logger } from '@nestjs/common';
import type { EmailMessage } from '../email.types.js';
import { EmailTransport, SentEmail } from './email-transport.js';

/** Desenvolvimento sem RESEND_API_KEY: o e-mail vai para o log, com os links clicáveis. */
export class ConsoleTransport implements EmailTransport {
  readonly name = 'console';
  private readonly logger = new Logger('EmailConsole');

  send(message: EmailMessage): Promise<SentEmail> {
    this.logger.log(
      [
        `E-mail não enviado (sem RESEND_API_KEY)`,
        `De: ${message.from}`,
        `Para: ${message.to}`,
        ...(message.replyTo ? [`Responder para: ${message.replyTo}`] : []),
        `Assunto: ${message.subject}`,
        '',
        message.text,
      ].join('\n'),
    );

    return Promise.resolve({ providerMessageId: null });
  }
}
