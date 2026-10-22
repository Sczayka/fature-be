import type { Prisma } from '@prisma/client';
import type {
  AmountType,
  PromotionApplication,
} from '../invoices/invoices.constants.js';
import type { PromotionRules } from '../invoices/pricing/invoice-pricing.js';
import type { IssuingPromotion } from '../invoices/pricing/invoice-rules.js';
import { ISSUING_PROMOTION_SELECT } from './promotions.constants.js';

type IssuingPromotionRow = Prisma.PromotionGetPayload<{
  select: typeof ISSUING_PROMOTION_SELECT;
}>;

/** Data da validade (gravada à meia-noite UTC) como YYYY-MM-DD. */
export function toDateOnly(date: Date | null): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}

/** Promoção cadastrada no formato que a emissão confere (src/invoices/pricing/invoice-rules.ts). */
export function toIssuingPromotion({
  items,
  startsAt,
  endsAt,
  ...promotion
}: IssuingPromotionRow): IssuingPromotion {
  return {
    ...promotion,
    type: promotion.type as AmountType,
    application: promotion.application as PromotionApplication,
    startsAt: toDateOnly(startsAt),
    endsAt: toDateOnly(endsAt),
    itemIds: items.map((link) => link.itemId),
  };
}

/** Cópia das regras gravada no desconto do item da cobrança, com o nome atual da promoção. */
export function toPromotionRules(promotion: IssuingPromotion): PromotionRules {
  return {
    id: promotion.id,
    name: promotion.name,
    application: promotion.application,
    maxAmount: promotion.maxAmount,
    maxQuantity: promotion.maxQuantity,
  };
}
