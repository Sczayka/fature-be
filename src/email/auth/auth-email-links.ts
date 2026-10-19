import { frontendUrl } from '../../common/utils/public-url.js';

/** Páginas do fature-fe abertas pelos e-mails do Better Auth (aliases em pt-BR do next.config). */
export const RESET_PASSWORD_PATH = '/redefinir-senha';
export const EMAIL_VERIFIED_PATH = '/email-verificado';
export const INVITATION_PATH = '/convite';

/** Direto para o formulário do fature-fe, que troca a senha com o token (POST /reset-password). */
export function resetPasswordUrl(token: string): string {
  return `${frontendUrl()}${RESET_PASSWORD_PATH}?token=${encodeURIComponent(token)}`;
}

/**
 * Mantém o link do Better Auth (que confirma o e-mail e já abre a sessão) e volta para a página de
 * confirmação do fature-fe, inclusive com `?error=` quando o token não vale.
 */
export function verificationUrl(betterAuthUrl: string): string {
  const url = new URL(betterAuthUrl);

  url.searchParams.set('callbackURL', `${frontendUrl()}${EMAIL_VERIFIED_PATH}`);

  return url.toString();
}

export function invitationUrl(invitationId: string): string {
  return `${frontendUrl()}${INVITATION_PATH}/${encodeURIComponent(invitationId)}`;
}
