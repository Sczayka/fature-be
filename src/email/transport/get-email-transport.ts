import { Logger } from '@nestjs/common';
import { Resend } from 'resend';
import { ConsoleTransport } from './console.transport.js';
import type { EmailTransport } from './email-transport.js';
import { RedirectTransport } from './redirect.transport.js';
import { ResendTransport } from './resend.transport.js';

let transport: EmailTransport | null = null;

/**
 * Transporte compartilhado pelo Nest e pelo Better Auth (que roda fora da injeção de
 * dependências). Criado no primeiro uso: o env já foi carregado, qualquer que seja a ordem dos
 * imports.
 */
export function getEmailTransport(): EmailTransport {
  transport ??= createEmailTransport(process.env);

  return transport;
}

export function createEmailTransport(env: NodeJS.ProcessEnv): EmailTransport {
  const apiKey = env.RESEND_API_KEY?.trim();

  if (!apiKey && env.NODE_ENV === 'production') {
    new Logger('EmailTransport').warn(
      'RESEND_API_KEY não definida: os e-mails só vão para o log.',
    );
  }

  const base: EmailTransport = apiKey
    ? new ResendTransport(new Resend(apiKey))
    : new ConsoleTransport();
  const redirectTo = env.EMAIL_REDIRECT_TO?.trim();

  return redirectTo ? new RedirectTransport(base, redirectTo) : base;
}
