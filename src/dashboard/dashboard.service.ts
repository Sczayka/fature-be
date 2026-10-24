import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { roundCurrency } from '../common/utils/currency.js';
import { toAmount } from '../financial/financial-balance.js';
import {
  ENTRY_DIRECTION,
  ENTRY_PAYMENT_METHODS,
} from '../financial/financial.constants.js';
import {
  monthEnd,
  monthStart,
  toDateOnly,
} from '../financial/financial-dates.js';
import { OPEN_DRAFT } from '../invoices/drafts/invoice-drafts.constants.js';
import {
  invoiceStatusWhere,
  receivableInvoicesWhere,
} from '../invoices/invoice-status.js';
import { INVOICE_STATUS } from '../invoices/invoices.constants.js';
import {
  addDays,
  startOfDayInBillingTimezone,
  todayInBillingTimezone,
  utcMidnight,
} from '../invoices/pricing/dates.js';
import {
  calcNominalValue,
  pricingRulesFromDraft,
} from '../invoices/pricing/invoice-pricing.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  INVOICE_RECEIPT,
  QUOTE_CONVERSION_DAYS,
  RECEIPTS_PERIODS,
  SHORTLIST_SIZE,
  type ReceiptsGranularity,
  type ReceiptsPeriod,
} from './dashboard.constants.js';

const ZERO = new Prisma.Decimal(0);

/** Fatura nas listas curtas: o cliente, o valor nominal e o vencimento. */
const SHORTLIST_INVOICE_SELECT = {
  id: true,
  totalValue: true,
  dueDate: true,
  client: { select: { id: true, name: true } },
} satisfies Prisma.InvoiceSelect;

type ShortlistInvoiceRow = Prisma.InvoiceGetPayload<{
  select: typeof SHORTLIST_INVOICE_SELECT;
}>;

const LATEST_PAYMENT_SELECT = {
  id: true,
  invoiceId: true,
  paidAmount: true,
  feeAmount: true,
  paymentDate: true,
  paymentMethod: true,
  client: { select: { id: true, name: true } },
} satisfies Prisma.FinancialEntrySelect;

/** Recebimentos agrupados pelo sentido (e, no gráfico, pelo dia e pela forma). */
interface ReceiptGroup {
  direction: string;
  _count: { _all: number };
  _sum: {
    paidAmount: Prisma.Decimal | null;
    feeAmount: Prisma.Decimal | null;
  };
}

/** Pagamentos (quantos, bruto e taxa do provedor) e devoluções, somados. */
interface ReceiptSums {
  count: number;
  gross: Prisma.Decimal;
  fees: Prisma.Decimal;
  refunded: Prisma.Decimal;
}

const NO_RECEIPTS: ReceiptSums = {
  count: 0,
  gross: ZERO,
  fees: ZERO,
  refunded: ZERO,
};

function sumReceipts(groups: ReceiptGroup[]): ReceiptSums {
  return groups.reduce((sums, group) => {
    const paid = group._sum.paidAmount ?? ZERO;

    if (group.direction !== ENTRY_DIRECTION.IN) {
      return { ...sums, refunded: sums.refunded.plus(paid) };
    }

    return {
      ...sums,
      count: sums.count + group._count._all,
      gross: sums.gross.plus(paid),
      fees: sums.fees.plus(group._sum.feeAmount ?? ZERO),
    };
  }, NO_RECEIPTS);
}

/** Bruto, taxas, devoluções e o líquido que ficou, como em GET /financial/receipts/totals. */
function toReceiptTotals(sums: ReceiptSums) {
  return {
    count: sums.count,
    gross: toAmount(sums.gross),
    fees: toAmount(sums.fees),
    refunded: toAmount(sums.refunded),
    net: toAmount(sums.gross.minus(sums.fees).minus(sums.refunded)),
  };
}

/** Parte do todo, em 4 casas (0,1234 = 12,34%); null sem o todo. */
function ratio(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 10_000) / 10_000 : null;
}

function toShortlistInvoice(invoice: ShortlistInvoiceRow) {
  return {
    id: invoice.id,
    client: invoice.client,
    totalValue: roundCurrency(invoice.totalValue),
    dueDate: toDateOnly(invoice.dueDate),
  };
}

/** Dia 1 do mês (YYYY-MM-01) somado de `months` meses (negativo volta). */
function shiftMonth(firstDay: string, months: number): string {
  const [year, month] = firstDay.split('-').map(Number);

  return new Date(Date.UTC(year, month - 1 + months, 1))
    .toISOString()
    .slice(0, 10);
}

/**
 * Intervalos do período até hoje (o de hoje incluído): os dias ou os meses, cada um pelo seu
 * primeiro dia (YYYY-MM-DD).
 */
export function receiptsBuckets(
  period: ReceiptsPeriod,
  today: string,
): { granularity: ReceiptsGranularity; starts: string[] } {
  const { granularity, size } = RECEIPTS_PERIODS[period];
  const offsets = Array.from({ length: size }, (_, index) => index - size + 1);

  return {
    granularity,
    starts:
      granularity === 'day'
        ? offsets.map((offset) => addDays(today, offset))
        : offsets.map((offset) => shiftMonth(monthStart(today), offset)),
  };
}

/** Na ordem de ENTRY_PAYMENT_METHODS; uma forma desconhecida vai para o fim. */
function byMethodOrder(a: string, b: string): number {
  const order = (method: string) => {
    const index = (ENTRY_PAYMENT_METHODS as readonly string[]).indexOf(method);

    return index === -1 ? ENTRY_PAYMENT_METHODS.length : index;
  };

  return order(a) - order(b);
}

/**
 * Números da tela inicial, calculados na leitura com as mesmas regras das telas de cada assunto:
 * o status exibido das faturas (`invoiceStatusWhere`) e os recebimentos das faturas no financeiro
 * (bruto, taxa do provedor e devoluções).
 */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(organizationId: string) {
    const today = todayInBillingTimezone();
    const [indicators, shortlists, quotes] = await Promise.all([
      this.indicators(organizationId, today),
      this.shortlists(organizationId, today),
      this.quotes(organizationId, today),
    ]);

    return { today, ...indicators, ...shortlists, quotes };
  }

  /**
   * Recebimentos das faturas no período, por dia ou por mês e por forma de pagamento, pela data do
   * recebimento. As formas são só as que receberam algo no período.
   */
  async receipts(organizationId: string, period: ReceiptsPeriod) {
    const today = todayInBillingTimezone();
    const { granularity, starts } = receiptsBuckets(period, today);
    const groups = await this.prisma.financialEntry.groupBy({
      by: ['paymentDate', 'paymentMethod', 'direction'],
      where: {
        organizationId,
        ...INVOICE_RECEIPT,
        paymentMethod: { not: null },
        paymentDate: { gte: utcMidnight(starts[0]), lte: utcMidnight(today) },
      },
      _count: { _all: true },
      _sum: { paidAmount: true, feeAmount: true },
    });
    const rows = groups.map((group) => {
      const day = toDateOnly(group.paymentDate!);

      return {
        ...group,
        method: group.paymentMethod!,
        bucket: granularity === 'day' ? day : monthStart(day),
      };
    });
    const payments = rows.filter((row) => row.direction === ENTRY_DIRECTION.IN);
    const methods = [...new Set(payments.map((row) => row.method))].sort(
      byMethodOrder,
    );
    const grossOf = (method: string, groupsOfBucket: typeof rows) =>
      toAmount(
        sumReceipts(groupsOfBucket.filter((row) => row.method === method))
          .gross,
      );

    return {
      period,
      granularity,
      from: starts[0],
      to: today,
      series: starts.map((start) => {
        const inBucket = rows.filter((row) => row.bucket === start);

        return {
          start,
          ...toReceiptTotals(sumReceipts(inBucket)),
          byMethod: methods.map((method) => ({
            method,
            gross: grossOf(method, inBucket),
          })),
        };
      }),
      methods: methods
        .map((method) => {
          const sums = sumReceipts(
            payments.filter((row) => row.method === method),
          );

          return {
            method,
            count: sums.count,
            gross: toAmount(sums.gross),
            fees: toAmount(sums.fees),
          };
        })
        .sort((a, b) => b.gross - a.gross),
      totals: toReceiptTotals(sumReceipts(rows)),
    };
  }

  /**
   * A receber (pendente a vencer e aguardando conferência) e vencido, pelo valor nominal; o
   * recebido no mês; e o ticket médio das faturas emitidas no mês. A inadimplência é a parte
   * vencida do valor que já venceu (pago ou não, sem as canceladas).
   */
  private async indicators(organizationId: string, today: string) {
    const scoped = (
      where: Prisma.InvoiceWhereInput,
    ): Prisma.InvoiceWhereInput => ({ organizationId, AND: [where] });
    const notCancelled = { not: INVOICE_STATUS.CANCELLED };
    const firstDay = monthStart(today);

    const [receivable, overdue, due, issued, received] = await Promise.all([
      this.prisma.invoice.aggregate({
        where: scoped(receivableInvoicesWhere(today)),
        _count: { _all: true },
        _sum: { totalValue: true },
      }),
      this.prisma.invoice.aggregate({
        where: scoped(invoiceStatusWhere(INVOICE_STATUS.OVERDUE, today)),
        _count: { _all: true },
        _sum: { totalValue: true },
      }),
      this.prisma.invoice.aggregate({
        where: {
          organizationId,
          status: notCancelled,
          dueDate: { lt: utcMidnight(today) },
        },
        _sum: { totalValue: true },
      }),
      // createdAt é um instante: o mês começa à meia-noite no fuso de cobrança
      this.prisma.invoice.aggregate({
        where: {
          organizationId,
          status: notCancelled,
          createdAt: { gte: startOfDayInBillingTimezone(firstDay) },
        },
        _count: { _all: true },
        _avg: { totalValue: true },
      }),
      this.prisma.financialEntry.groupBy({
        by: ['direction'],
        where: {
          organizationId,
          ...INVOICE_RECEIPT,
          paymentDate: {
            gte: utcMidnight(firstDay),
            lte: utcMidnight(monthEnd(today)),
          },
        },
        _count: { _all: true },
        _sum: { paidAmount: true, feeAmount: true },
      }),
    ]);
    const overdueTotal = roundCurrency(overdue._sum.totalValue ?? 0);

    return {
      receivable: {
        count: receivable._count._all,
        total: roundCurrency(receivable._sum.totalValue ?? 0),
      },
      overdue: {
        count: overdue._count._all,
        total: overdueTotal,
        rate: ratio(overdueTotal, due._sum.totalValue ?? 0),
      },
      receivedThisMonth: toReceiptTotals(sumReceipts(received)),
      averageTicket: {
        count: issued._count._all,
        average: roundCurrency(issued._avg.totalValue ?? 0),
      },
    };
  }

  /**
   * As próximas a vencer, as que venceram por último e os últimos pagamentos recebidos. As listas
   * completas ficam nas telas de faturas e de recebimentos.
   */
  private async shortlists(organizationId: string, today: string) {
    const [upcoming, overdue, payments] = await Promise.all([
      this.prisma.invoice.findMany({
        where: {
          organizationId,
          AND: [invoiceStatusWhere(INVOICE_STATUS.PENDING, today)],
        },
        orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
        take: SHORTLIST_SIZE,
        select: SHORTLIST_INVOICE_SELECT,
      }),
      this.prisma.invoice.findMany({
        where: {
          organizationId,
          AND: [invoiceStatusWhere(INVOICE_STATUS.OVERDUE, today)],
        },
        orderBy: [{ dueDate: 'desc' }, { createdAt: 'desc' }],
        take: SHORTLIST_SIZE,
        select: SHORTLIST_INVOICE_SELECT,
      }),
      this.prisma.financialEntry.findMany({
        where: {
          organizationId,
          ...INVOICE_RECEIPT,
          direction: ENTRY_DIRECTION.IN,
          paymentMethod: { not: null },
          paymentDate: { not: null },
        },
        orderBy: [
          { paymentDate: 'desc' },
          { createdAt: 'desc' },
          { id: 'desc' },
        ],
        take: SHORTLIST_SIZE,
        select: LATEST_PAYMENT_SELECT,
      }),
    ]);

    return {
      upcomingInvoices: upcoming.map(toShortlistInvoice),
      overdueInvoices: overdue.map(toShortlistInvoice),
      latestPayments: payments.map((payment) => ({
        id: payment.id,
        invoiceId: payment.invoiceId,
        client: payment.client,
        method: payment.paymentMethod!,
        amount: toAmount(payment.paidAmount ?? ZERO),
        fee: toAmount(payment.feeAmount),
        paymentDate: toDateOnly(payment.paymentDate!),
      })),
    };
  }

  /**
   * Orçamentos em aberto (pelo valor nominal, com os descontos dos itens) e a taxa de conversão
   * dos criados nos últimos dias. O excluído não entra na conta; o convertido antes do registro
   * da conversão também não (era apagado).
   */
  private async quotes(organizationId: string, today: string) {
    const recent = {
      organizationId,
      createdAt: {
        gte: startOfDayInBillingTimezone(
          addDays(today, -(QUOTE_CONVERSION_DAYS - 1)),
        ),
      },
    } satisfies Prisma.InvoiceDraftWhereInput;

    const [open, created, converted] = await Promise.all([
      this.prisma.invoiceDraft.findMany({
        where: { organizationId, ...OPEN_DRAFT },
        select: {
          items: true,
          billing: true,
          discount: true,
          interestAndFine: true,
        },
      }),
      this.prisma.invoiceDraft.count({ where: recent }),
      this.prisma.invoiceDraft.count({
        where: { ...recent, convertedAt: { not: null } },
      }),
    ]);
    const openTotal = open.reduce(
      (total, draft) => total + calcNominalValue(pricingRulesFromDraft(draft)),
      0,
    );

    return {
      open: { count: open.length, total: roundCurrency(openTotal) },
      conversion: {
        days: QUOTE_CONVERSION_DAYS,
        created,
        converted,
        rate: ratio(converted, created),
      },
    };
  }
}
