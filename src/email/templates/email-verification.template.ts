import type { RenderedEmail } from '../email.types.js';
import { AUTH_FOOTER } from './auth-footer.js';
import { fatureBrand } from './brand.js';
import { button, heading, note, paragraph, renderEmail } from './layout.js';

export function renderEmailVerificationEmail(data: {
  name: string;
  url: string;
}): RenderedEmail {
  return renderEmail({
    brand: fatureBrand(),
    subject: 'Confirme seu e-mail no Fature',
    preheader: 'Falta só confirmar o seu e-mail.',
    blocks: [
      heading('Confirme seu e-mail'),
      paragraph(
        `Olá, ${data.name}. Confirme o seu e-mail para concluir o cadastro no Fature.`,
      ),
      button('Confirmar e-mail', data.url),
      note(
        'O link vale por 24 horas. Se você não criou uma conta no Fature, ignore este e-mail.',
      ),
    ],
    footer: AUTH_FOOTER,
  });
}
