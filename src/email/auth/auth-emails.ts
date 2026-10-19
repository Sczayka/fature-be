import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import type { RenderedEmail } from '../email.types.js';
import { fatureSender } from '../sender.js';
import {
  EmailDeliveryError,
  type EmailTransport,
} from '../transport/email-transport.js';
import { getEmailTransport } from '../transport/get-email-transport.js';

/** Esperas entre as tentativas, dentro do próprio processo. */
export const AUTH_EMAIL_RETRY_DELAYS_MS = [2_000, 10_000];

const logger = new Logger('AuthEmails');

/**
 * E-mails do próprio Fature (senha, verificação, convite), chamados pelo Better Auth. Não espera o
 * envio: o tempo de resposta não pode revelar se o e-mail está cadastrado. Não grava EmailLog: o
 * link carrega um token, e o usuário pode pedir outro.
 */
export function sendAuthEmail(
  to: string,
  content: RenderedEmail,
  { replyTo }: { replyTo: string | null } = { replyTo: null },
): void {
  void deliverAuthEmail(to, content, replyTo, getEmailTransport());
}

/** Tenta algumas vezes com a mesma chave de idempotência; nunca lança. */
export async function deliverAuthEmail(
  to: string,
  content: RenderedEmail,
  replyTo: string | null,
  transport: EmailTransport,
): Promise<boolean> {
  const idempotencyKey = `auth-email/${randomUUID()}`;
  const message = {
    from: fatureSender(),
    to,
    replyTo,
    ...content,
    tags: { type: 'AUTH' },
  };

  for (let attempt = 0; ; attempt++) {
    try {
      await transport.send(message, { idempotencyKey });

      return true;
    } catch (error) {
      const permanent = error instanceof EmailDeliveryError && error.permanent;

      if (permanent || attempt >= AUTH_EMAIL_RETRY_DELAYS_MS.length) {
        logger.error(`E-mail "${content.subject}" não enviado`, error);

        return false;
      }

      await sleep(AUTH_EMAIL_RETRY_DELAYS_MS[attempt]);
    }
  }
}
