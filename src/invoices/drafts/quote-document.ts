import type { Prisma } from '@prisma/client';
import {
  formatBRL,
  formatCpfCnpj,
  formatPercent,
  formatPhoneBR,
} from '../../common/utils/format.js';
import { brandFromOrganization } from '../../email/templates/brand.js';
import { PAYER_ORGANIZATION_SELECT } from '../../email/templates/payer.js';
import {
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
} from '../invoices.constants.js';
import {
  AmountRule,
  calcDiscountAmount,
  calcItemDiscount,
  calcItemsDiscount,
  calcNominalValue,
  calcSubtotal,
  discountDeadline,
  draftLines,
  pricingRulesFromDraft,
  roundCurrency,
} from '../pricing/invoice-pricing.js';

/** Orçamento com o que o cliente vê no PDF e no e-mail; os dados da empresa servem aos dois. */
export const QUOTE_DOCUMENT_SELECT = {
  client: true,
  items: true,
  billing: true,
  paymentMethods: true,
  discount: true,
  interestAndFine: true,
  updatedAt: true,
  organization: {
    select: {
      ...PAYER_ORGANIZATION_SELECT,
      cnpj: true,
      logoImage: { select: { mimeType: true, data: true } },
    },
  },
} satisfies Prisma.InvoiceDraftSelect;

export type QuoteDraft = Prisma.InvoiceDraftGetPayload<{
  select: typeof QUOTE_DOCUMENT_SELECT;
}>;

/** Bloco do cliente salvo no orçamento (pode não ser um cliente cadastrado). */
export interface DraftClient {
  id?: string;
  name?: string;
  email?: string;
  cpfCnpj?: string;
  phone?: string;
  mobile?: string;
}

/** O PDF só embute PNG e JPEG; os outros logos dão lugar ao nome da empresa. */
const PDF_LOGO_MIME_TYPES = /^image\/(png|jpeg)$/;

export interface QuoteLine {
  name: string;
  quantity: number;
  unitPrice: number;
  /** Total da linha antes do desconto do item. */
  total: number;
  discount: number;
}

export interface QuotePaymentMethod {
  label: string;
  /** Desconto (R$) por pagar com esta forma; 0 quando não há. */
  discount: number;
  /** YYYY-MM-DD; null quando o desconto não tem prazo definido (orçamento sem vencimento). */
  discountUntil: string | null;
}

export interface QuoteDocument {
  issuedAt: Date;
  organization: {
    name: string;
    document: string | null;
    email: string | null;
    phone: string | null;
    accentColor: string;
    logo: Buffer | null;
  };
  client: {
    name: string | null;
    document: string | null;
    email: string | null;
    phone: string | null;
  };
  description: string | null;
  lines: QuoteLine[];
  subtotal: number;
  itemsDiscount: number;
  total: number;
  /** YYYY-MM-DD; o orçamento pode não ter vencimento. */
  dueDate: string | null;
  paymentMethods: QuotePaymentMethod[];
  /** Multa e juros após o vencimento, em texto; null quando não há. */
  lateCharges: string | null;
}

function textOrNull(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

function amountLabel(rule: AmountRule): string {
  return rule.type === 'PERCENTAGE'
    ? formatPercent(rule.value)
    : formatBRL(rule.value);
}

/** Orçamento salvo como o cliente o vê: totais pelas mesmas regras da cobrança. */
export function toQuoteDocument(draft: QuoteDraft): QuoteDocument {
  const { organization } = draft;
  const rules = pricingRulesFromDraft(draft);
  const nominalValue = calcNominalValue(rules);
  const client = (draft.client ?? {}) as DraftClient;
  const billing = draft.billing as {
    dueDate?: string;
    description?: string;
  } | null;
  const dueDate = textOrNull(billing?.dueDate);
  const logo =
    organization.logoImage &&
    PDF_LOGO_MIME_TYPES.test(organization.logoImage.mimeType)
      ? Buffer.from(organization.logoImage.data)
      : null;
  const phone = textOrNull(organization.mobilePhone || organization.phone);
  const clientDocument = textOrNull(client.cpfCnpj);
  const clientPhone = textOrNull(client.mobile || client.phone);
  const organizationDocument = textOrNull(organization.cnpj);

  const { fineType, fineValue, interestType, interestValue } =
    rules.interestAndFine;
  const lateCharges = [
    ...(fineValue > 0
      ? [`multa de ${amountLabel({ type: fineType, value: fineValue })}`]
      : []),
    ...(interestValue > 0
      ? [
          `juros de ${amountLabel({ type: interestType, value: interestValue })} ao mês`,
        ]
      : []),
  ];

  return {
    issuedAt: draft.updatedAt,
    organization: {
      name: organization.name,
      document: organizationDocument && formatCpfCnpj(organizationDocument),
      email: textOrNull(organization.contactEmail),
      phone: phone && formatPhoneBR(phone),
      accentColor: brandFromOrganization(organization).buttonColor,
      logo,
    },
    client: {
      name: textOrNull(client.name),
      document: clientDocument && formatCpfCnpj(clientDocument),
      email: textOrNull(client.email),
      phone: clientPhone && formatPhoneBR(clientPhone),
    },
    description: textOrNull(billing?.description),
    lines: draftLines(draft.items).map((line) => ({
      name: line.item.name,
      quantity: line.quantity,
      unitPrice: roundCurrency(line.total / Math.max(line.quantity, 1)),
      total: line.total,
      discount: calcItemDiscount(rules, {
        id: line.item.id,
        total: line.total,
      }),
    })),
    subtotal: calcSubtotal(rules.items),
    itemsDiscount: calcItemsDiscount(rules),
    total: nominalValue,
    dueDate,
    paymentMethods: PAYMENT_METHODS.filter((method) =>
      draft.paymentMethods.includes(method),
    ).map((method) => {
      const rule = rules.discount.methods.find((row) => row.method === method);

      return {
        label: PAYMENT_METHOD_LABELS[method],
        discount: rule ? calcDiscountAmount(nominalValue, rule) : 0,
        discountUntil: rule
          ? textOrNull(discountDeadline(rule, dueDate ?? ''))
          : null,
      };
    }),
    lateCharges:
      lateCharges.length > 0
        ? `Após o vencimento: ${lateCharges.join(' e ')}.`
        : null,
  };
}
