import type { Prisma } from '@prisma/client';
import {
  ENTRY_ORIGIN,
  ENTRY_STATUS,
} from '../financial/financial.constants.js';

/**
 * Períodos do gráfico de recebimentos: os últimos 30 dias, dia a dia, ou os últimos meses, mês a
 * mês (o atual incluído, até hoje).
 */
export const RECEIPTS_PERIODS = {
  '30d': { granularity: 'day', size: 30 },
  '6m': { granularity: 'month', size: 6 },
  '12m': { granularity: 'month', size: 12 },
} as const;

export type ReceiptsPeriod = keyof typeof RECEIPTS_PERIODS;

export type ReceiptsGranularity =
  (typeof RECEIPTS_PERIODS)[ReceiptsPeriod]['granularity'];

export const RECEIPTS_PERIOD_KEYS = Object.keys(
  RECEIPTS_PERIODS,
) as ReceiptsPeriod[];

export const DEFAULT_RECEIPTS_PERIOD: ReceiptsPeriod = '6m';

/** Faturas e pagamentos nas listas curtas do dashboard. */
export const SHORTLIST_SIZE = 5;

/** Janela da taxa de conversão: os orçamentos criados nos últimos dias. */
export const QUOTE_CONVERSION_DAYS = 90;

/**
 * Recebimentos das faturas no financeiro: os pagamentos (IN) e as devoluções (OUT) confirmados,
 * cópias das movimentações (InvoiceReceiptsService). Os lançados pela empresa não entram: o
 * dashboard mostra as cobranças.
 */
export const INVOICE_RECEIPT = {
  origin: ENTRY_ORIGIN.INVOICE,
  status: ENTRY_STATUS.PAID,
} satisfies Prisma.FinancialEntryWhereInput;
