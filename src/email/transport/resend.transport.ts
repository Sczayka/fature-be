import { Logger } from '@nestjs/common';
import type { ErrorResponse, Resend } from 'resend';
import type { EmailMessage } from '../email.types.js';
import {
  EmailDeliveryError,
  EmailTransport,
  SendEmailOptions,
  SentEmail,
} from './email-transport.js';

/** Envio pelo Resend. O SDK devolve o erro em vez de lançar; falhas de rede também chegam assim. */
export class ResendTransport implements EmailTransport {
  readonly name = 'resend';
  private readonly logger = new Logger(ResendTransport.name);

  constructor(private readonly resend: Pick<Resend, 'emails'>) {}

  async send(
    message: EmailMessage,
    { idempotencyKey }: SendEmailOptions,
  ): Promise<SentEmail> {
    let response: Awaited<ReturnType<Resend['emails']['send']>>;

    try {
      response = await this.resend.emails.send(
        {
          from: message.from,
          to: message.to,
          ...(message.replyTo ? { replyTo: message.replyTo } : {}),
          subject: message.subject,
          html: message.html,
          text: message.text,
          tags: Object.entries(message.tags).map(([name, value]) => ({
            name,
            value,
          })),
        },
        { idempotencyKey },
      );
    } catch (error) {
      this.logger.error(`Resend indisponível (${idempotencyKey})`, error);

      throw new EmailDeliveryError('Provedor de e-mail indisponível.', false);
    }

    if (response.error) {
      this.logger.error(
        `Resend recusou o envio ${idempotencyKey}: ${response.error.statusCode ?? '-'} ${response.error.name} ${response.error.message}`,
      );

      throw toDeliveryError(response.error);
    }

    return { providerMessageId: response.data?.id ?? null };
  }
}

/**
 * 400 e 422 (dados recusados) e um conteúdo diferente para a mesma chave são permanentes. Chave de
 * API, domínio não verificado, limites e erros do provedor são temporários: corrigida a causa, a
 * próxima tentativa sai.
 */
export function toDeliveryError(error: ErrorResponse): EmailDeliveryError {
  if (error.name === 'invalid_idempotent_request') {
    return new EmailDeliveryError(
      'Envio repetido com conteúdo diferente.',
      true,
    );
  }

  switch (error.statusCode) {
    case 400:
    case 422:
      return new EmailDeliveryError(
        'E-mail recusado pelo provedor: confira o endereço do destinatário.',
        true,
      );
    case 401:
    case 403:
      return new EmailDeliveryError(
        'Envio não autorizado pelo provedor (chave de API ou domínio remetente).',
        false,
      );
    case 429:
      return new EmailDeliveryError(
        'Limite de envios do provedor atingido.',
        false,
      );
    default:
      return new EmailDeliveryError('Provedor de e-mail indisponível.', false);
  }
}
