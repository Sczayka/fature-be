import type { RenderedEmail } from '../email.types.js';
import { AUTH_FOOTER } from './auth-footer.js';
import { fatureBrand } from './brand.js';
import { button, heading, note, paragraph, renderEmail } from './layout.js';

export function renderPasswordResetEmail(data: {
  name: string;
  url: string;
  expiresInMinutes: number;
}): RenderedEmail {
  return renderEmail({
    brand: fatureBrand(),
    subject: 'Redefinição de senha do Fature',
    preheader: 'Use o link para criar uma nova senha.',
    blocks: [
      heading('Redefinição de senha'),
      paragraph(
        `Olá, ${data.name}. Recebemos um pedido para redefinir a senha da sua conta no Fature.`,
      ),
      button('Redefinir senha', data.url),
      note(
        `O link vale por ${data.expiresInMinutes} minutos. Se você não pediu a redefinição, ignore este e-mail: a sua senha continua a mesma.`,
      ),
    ],
    footer: AUTH_FOOTER,
  });
}
