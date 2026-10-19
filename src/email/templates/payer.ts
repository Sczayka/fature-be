import type { Prisma } from '@prisma/client';
import { organizationSender } from '../sender.js';
import { EmailBrand, brandFromOrganization } from './brand.js';

/** Dados da organização usados nos e-mails aos pagadores. */
export const PAYER_ORGANIZATION_SELECT = {
  name: true,
  logo: true,
  backgroundColor: true,
  buttonColor: true,
  contactEmail: true,
  phone: true,
  mobilePhone: true,
  logoImage: { select: { mimeType: true } },
} satisfies Prisma.OrganizationSelect;

export type PayerOrganization = Prisma.OrganizationGetPayload<{
  select: typeof PAYER_ORGANIZATION_SELECT;
}>;

/** Quem envia o e-mail ao pagador e como ele fala com a empresa. */
export interface PayerContext {
  brand: EmailBrand;
  organizationName: string;
  sender: string;
  /** Reply-To: e-mail de contato da empresa (aba Dados da empresa). */
  replyTo: string | null;
  contactPhone: string | null;
}

export function payerContext(organization: PayerOrganization): PayerContext {
  return {
    brand: brandFromOrganization(organization),
    organizationName: organization.name,
    sender: organizationSender(organization.name),
    replyTo: organization.contactEmail,
    contactPhone: organization.mobilePhone || organization.phone || null,
  };
}

/** Rodapé: por que o pagador recebeu o e-mail e como falar com a empresa. */
export function payerFooter(payer: PayerContext, reason: string): string[] {
  const contact = payer.replyTo
    ? `Dúvidas? Responda este e-mail para falar com ${payer.organizationName}.`
    : payer.contactPhone
      ? `Este endereço não recebe respostas. Fale com ${payer.organizationName} pelo telefone ${payer.contactPhone}.`
      : 'Este endereço não recebe respostas.';

  return [reason, contact];
}
