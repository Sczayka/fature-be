import type { Prisma } from '@prisma/client';

/** Sentido no saldo: entrada e devolução somam, venda subtrai e ajuste vai para o saldo contado. */
export const STOCK_MOVEMENT_TYPE = {
  ENTRY: 'ENTRY',
  SALE: 'SALE',
  ADJUSTMENT: 'ADJUSTMENT',
  RETURN: 'RETURN',
} as const;

export type StockMovementType =
  (typeof STOCK_MOVEMENT_TYPE)[keyof typeof STOCK_MOVEMENT_TYPE];

/** Lançadas pela empresa; a venda vem só da emissão da cobrança. */
export const MANUAL_STOCK_MOVEMENT_TYPES = [
  STOCK_MOVEMENT_TYPE.ENTRY,
  STOCK_MOVEMENT_TYPE.RETURN,
  STOCK_MOVEMENT_TYPE.ADJUSTMENT,
] as const;

export type ManualStockMovementType =
  (typeof MANUAL_STOCK_MOVEMENT_TYPES)[number];

/** Teto de uma quantidade ou de um saldo digitado: a coluna é um inteiro de 32 bits. */
export const STOCK_QUANTITY_MAX = 1_000_000;

export const STOCK_NOTES_MAX_LENGTH = 500;

/** Observação da entrada gravada com o estoque informado no cadastro do produto. */
export const INITIAL_STOCK_NOTE = 'Saldo inicial do cadastro';

export const STOCK_MOVEMENT_SELECT = {
  id: true,
  itemId: true,
  type: true,
  quantity: true,
  balance: true,
  notes: true,
  createdAt: true,
  // Venda: a cobrança e o cliente, para o link no histórico
  invoice: {
    select: { id: true, client: { select: { id: true, name: true } } },
  },
  createdBy: { select: { id: true, name: true } },
} satisfies Prisma.StockMovementSelect;
