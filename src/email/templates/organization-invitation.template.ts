import { formatInstantDateBR } from '../../common/utils/format.js';
import type { RenderedEmail } from '../email.types.js';
import { AUTH_FOOTER } from './auth-footer.js';
import { fatureBrand } from './brand.js';
import { button, heading, note, paragraph, renderEmail } from './layout.js';

const ROLE_LABELS: Record<string, string> = {
  owner: 'dono',
  admin: 'administrador',
  member: 'membro',
};

export function renderOrganizationInvitationEmail(data: {
  inviterName: string;
  organizationName: string;
  role: string;
  url: string;
  expiresAt: Date;
}): RenderedEmail {
  const role = ROLE_LABELS[data.role] ?? data.role;

  return renderEmail({
    brand: fatureBrand(),
    subject: `${data.inviterName} convidou você para ${data.organizationName} no Fature`,
    preheader: `Convite para participar de ${data.organizationName}.`,
    blocks: [
      heading('Você recebeu um convite'),
      paragraph(
        `${data.inviterName} convidou você para participar de ${data.organizationName} no Fature como ${role}.`,
      ),
      button('Aceitar convite', data.url),
      note(
        `O convite vale até ${formatInstantDateBR(data.expiresAt)}. Se você não esperava este convite, ignore este e-mail.`,
      ),
    ],
    footer: AUTH_FOOTER,
  });
}
