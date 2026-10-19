import {
  DEFAULT_EMAIL_FROM,
  DEFAULT_EMAIL_FROM_NAME,
} from './email.constants.js';

const DISPLAY_NAME_MAX_LENGTH = 60;
const ORGANIZATION_SUFFIX = ' via Fature';

/** Nome exibido no remetente sem aspas, sinais de endereço e quebras de linha (injeção de cabeçalho). */
export function sanitizeDisplayName(name: string): string {
  return name
    .replace(/["<>\\\r\n]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, DISPLAY_NAME_MAX_LENGTH)
    .trim();
}

/** Assunto em uma linha só. */
export function sanitizeSubject(subject: string): string {
  return subject.replace(/[\r\n]+/g, ' ').trim();
}

function fromAddress(): string {
  return process.env.EMAIL_FROM || DEFAULT_EMAIL_FROM;
}

function formatSender(name: string): string {
  return `"${name}" <${fromAddress()}>`;
}

/** Remetente dos e-mails do próprio Fature (senha, verificação, convite). */
export function fatureSender(): string {
  return formatSender(
    sanitizeDisplayName(
      process.env.EMAIL_FROM_NAME || DEFAULT_EMAIL_FROM_NAME,
    ) || DEFAULT_EMAIL_FROM_NAME,
  );
}

/** Remetente dos e-mails aos pagadores: "{Empresa} via Fature". */
export function organizationSender(organizationName: string): string {
  const name = sanitizeDisplayName(organizationName).slice(
    0,
    DISPLAY_NAME_MAX_LENGTH - ORGANIZATION_SUFFIX.length,
  );

  return name
    ? formatSender(`${name.trim()}${ORGANIZATION_SUFFIX}`)
    : fatureSender();
}
