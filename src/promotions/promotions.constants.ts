import type { Prisma } from '@prisma/client';

export const PROMOTION_NOT_FOUND = 'Promoção não encontrada';

/** Itens por consulta de GET /promotions/available (os de uma cobrança). */
export const AVAILABLE_PROMOTIONS_MAX_ITEMS = 100;

/** Campos da promoção devolvidos pela listagem e pelo detalhe. */
const PROMOTION_FIELDS_SELECT = {
  id: true,
  name: true,
  type: true,
  value: true,
  application: true,
  maxAmount: true,
  maxQuantity: true,
  startsAt: true,
  endsAt: true,
  active: true,
  organizationId: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.PromotionSelect;

/** Listagem: só a quantidade de itens atendidos. */
export const PROMOTION_LIST_SELECT = {
  ...PROMOTION_FIELDS_SELECT,
  _count: { select: { items: true } },
} satisfies Prisma.PromotionSelect;

/** Detalhe: os itens atendidos, por nome. */
export const PROMOTION_DETAIL_SELECT = {
  ...PROMOTION_FIELDS_SELECT,
  items: {
    select: {
      item: { select: { id: true, name: true, type: true, price: true } },
    },
    orderBy: { item: { name: 'asc' } },
  },
} satisfies Prisma.PromotionSelect;

/** O que a emissão confere na promoção aplicada a um item (e o que a etapa Desconto oferece). */
export const ISSUING_PROMOTION_SELECT = {
  id: true,
  name: true,
  type: true,
  value: true,
  application: true,
  maxAmount: true,
  maxQuantity: true,
  startsAt: true,
  endsAt: true,
  active: true,
  items: { select: { itemId: true } },
} satisfies Prisma.PromotionSelect;
