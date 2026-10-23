import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { roundCurrency } from '../common/utils/currency.js';
import { paginationMeta, utcDayRange } from '../common/utils/pagination.js';
import { ChargesService } from '../payments/charges.service.js';
import { OrganizationPaymentMethodsService } from '../payments/organization-payment-methods.service.js';
import { toPaymentHttpException } from '../payments/payment-errors.js';
import { PaymentRoutingService } from '../payments/payment-routing.service.js';
import { CreateInvoiceDto } from './dto/create-invoice.dto.js';
import {
  InterestAndFineDto,
  InvoiceDiscountDto,
} from './dto/invoice-sections.dto.js';
import { ListInvoicesQueryDto } from './dto/list-invoices-query.dto.js';
import { checkoutUrl } from './checkout-url.js';
import {
  INVOICE_ISSUED_EVENT,
  type InvoiceIssuedEvent,
} from './invoice-events.js';
import {
  DEFAULT_CHARGE_DESCRIPTION,
  INVOICE_STATUS,
  PAYMENT_METHOD_LABELS,
  type InvoiceStatus,
} from './invoices.constants.js';
import { displayInvoiceStatus, invoiceStatusWhere } from './invoice-status.js';
import { paidDate, todayInBillingTimezone } from './pricing/dates.js';
import {
  DiscountRules,
  InterestAndFineRules,
  InvoicePricingRules,
  buildBankSlipCharge,
  calcNominalValue,
  pricingRulesFromInvoice,
} from './pricing/invoice-pricing.js';
import {
  MANUAL_PAYMENT_CONFIG_SELECT,
  isManualMethodAvailable,
} from '../payments/manual/manual-payment-config.js';
import {
  MANUAL_PAYMENT_METHODS,
  type ManualPaymentMethod,
} from '../payments/manual/manual-payments.constants.js';
import {
  computeInvoiceBalance,
  lockedMethod,
} from '../payments/transactions/invoice-balance.js';
import { BALANCE_TRANSACTION_SELECT } from '../payments/transactions/transactions.constants.js';
import {
  toIssuingPromotion,
  toPromotionRules,
} from '../promotions/promotion-rules.js';
import { ISSUING_PROMOTION_SELECT } from '../promotions/promotions.constants.js';
import { StockService } from '../stock/stock.service.js';
import {
  IssuingPromotion,
  validateIssuingRules,
} from './pricing/invoice-rules.js';

/** Campos da fatura devolvidos pela listagem e pelo detalhe (sem dados do provedor). */
const INVOICE_SUMMARY_SELECT = {
  id: true,
  clientId: true,
  client: { select: { id: true, name: true } },
  items: true,
  totalValue: true,
  dueDate: true,
  referenceDate: true,
  description: true,
  status: true,
  paymentMethods: true,
  checkoutToken: true,
  paidAt: true,
  paidMethod: true,
  paidValue: true,
  excessValue: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.InvoiceSelect;

const USER_NAME_SELECT = { select: { id: true, name: true } } as const;

/** Movimentações no detalhe: o saldo e a tela; a chave do comprovante não sai na resposta. */
const INVOICE_TRANSACTION_SELECT = {
  ...BALANCE_TRANSACTION_SELECT,
  statusReason: true,
  bankReference: true,
  proofKey: true,
  proofName: true,
  proofMimeType: true,
  notes: true,
  reviewedAt: true,
  cancelledAt: true,
  createdBy: USER_NAME_SELECT,
  reviewedBy: USER_NAME_SELECT,
  cancelledBy: USER_NAME_SELECT,
} satisfies Prisma.InvoiceTransactionSelect;

type InvoiceTransactionRow = Prisma.InvoiceTransactionGetPayload<{
  select: typeof INVOICE_TRANSACTION_SELECT;
}>;

const INVOICE_DETAIL_SELECT = {
  ...INVOICE_SUMMARY_SELECT,
  client: {
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      mobile: true,
      cpfCnpj: true,
      cep: true,
      addressLine: true,
      addressNumber: true,
      complement: true,
      district: true,
      state: true,
      city: true,
    },
  },
  discount: true,
  interestAndFine: true,
  // Cobranças sem o provedor, a conta ou as taxas: a organização não vê o roteamento
  charges: {
    select: {
      id: true,
      method: true,
      status: true,
      value: true,
      dueDate: true,
      validUntil: true,
      details: true,
      paidAt: true,
      paidValue: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  },
  transactions: {
    select: INVOICE_TRANSACTION_SELECT,
    orderBy: { createdAt: 'asc' },
  },
  // Só para as formas manuais em que o operador lança pagamento; não sai na resposta
  organization: { select: MANUAL_PAYMENT_CONFIG_SELECT },
} satisfies Prisma.InvoiceSelect;

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    private prisma: PrismaService,
    private routing: PaymentRoutingService,
    private paymentMethods: OrganizationPaymentMethodsService,
    private charges: ChargesService,
    private eventEmitter: EventEmitter2,
    private stock: StockService,
  ) {}

  /**
   * Persiste a invoice, dá baixa no estoque dos produtos e gera apenas o boleto (quando
   * habilitado), no provedor padrão do método para a organização. PIX e cartões são gerados no
   * checkout, com valores calculados pelo Fature a partir das regras salvas. `userId` é quem emitiu:
   * o autor da baixa no estoque.
   */
  async create(
    organizationId: string,
    createInvoiceDto: CreateInvoiceDto,
    userId: string,
  ) {
    const { billing, paymentMethods } = createInvoiceDto;
    const requestedDiscount = this.toDiscountRules(createInvoiceDto.discount);
    const interestAndFine = this.toInterestAndFineRules(
      createInvoiceDto.interestAndFine,
    );
    const items = createInvoiceDto.items.map((line) => ({
      id: line.item.id,
      name: line.item.name,
      type: line.item.type,
      price: line.item.price,
      quantity: line.quantity,
      total: line.total,
    }));

    // 1. Regras de emissão (antes de qualquer efeito colateral), com as promoções como estão hoje
    const promotions = await this.findIssuingPromotions(
      organizationId,
      requestedDiscount,
    );
    const issues = validateIssuingRules(
      {
        clientId: createInvoiceDto.client.id ?? '',
        items,
        dueDate: billing.dueDate,
        paymentMethods,
        discount: requestedDiscount,
        interestAndFine,
        promotions,
      },
      todayInBillingTimezone(),
    );

    if (issues.length > 0) {
      throw new BadRequestException({
        message: issues[0].message,
        details: issues.map((issue) => `${issue.path}: ${issue.message}`),
      });
    }

    // A cobrança guarda a cópia das regras conferidas, com o nome atual da promoção
    const discount: DiscountRules = {
      ...requestedDiscount,
      items: requestedDiscount.items.map((rule) => {
        const promotion = promotions.find(
          (row) => row.id === rule.promotion?.id,
        );

        return promotion
          ? { ...rule, promotion: toPromotionRules(promotion) }
          : rule;
      }),
    };

    // 2. Cliente da organização (o excluído só fica no histórico)
    const client = await this.prisma.client.findFirst({
      where: {
        id: createInvoiceDto.client.id,
        organizationId,
        deletedAt: null,
      },
    });

    if (!client) {
      throw new NotFoundException('Cliente não encontrado');
    }

    // 3. Cada método habilitado precisa estar disponível para a organização: no provedor padrão
    // ou como pagamento manual liberado (transferência e PIX com a chave da empresa)
    const [availability, routes] = await Promise.all([
      this.paymentMethods.availability(organizationId),
      this.routing.getRoutes(organizationId),
    ]);
    const unavailable = paymentMethods.filter(
      (method) => !availability.get(method),
    );

    if (unavailable.length > 0) {
      const labels = unavailable.map((method) => PAYMENT_METHOD_LABELS[method]);

      throw new BadRequestException({
        message: `Forma de pagamento indisponível: ${labels.join(', ')}`,
        details: unavailable.map(
          (method) =>
            `paymentMethods: ${PAYMENT_METHOD_LABELS[method]} indisponível`,
        ),
      });
    }

    // 4. Valores calculados pelo Fature (o boleto é o único método gerado agora)
    const pricingRules: InvoicePricingRules = {
      items,
      dueDate: billing.dueDate,
      discount,
      interestAndFine,
    };
    const bankSlip = paymentMethods.includes('BANK_SLIP')
      ? buildBankSlipCharge(pricingRules)
      : null;

    // 5. Persistir a invoice e dar baixa no estoque dos produtos, na mesma transação: a cobrança
    // emitida reserva o estoque (o orçamento não), mesmo que ainda não tenha sido paga
    const invoice = await this.prisma.$transaction(async (tx) => {
      const created = await tx.invoice.create({
        data: {
          organizationId,
          clientId: client.id,
          items: items as unknown as Prisma.InputJsonArray,
          totalValue: calcNominalValue(pricingRules),
          dueDate: new Date(billing.dueDate),
          referenceDate: billing.referenceDate
            ? new Date(billing.referenceDate)
            : null,
          description: billing.description?.trim() || null,
          status: 'PENDING',
          paymentMethods,
          discount: discount as unknown as Prisma.InputJsonObject,
          interestAndFine: interestAndFine as unknown as Prisma.InputJsonObject,
          checkoutToken: this.generateCheckoutToken(),
        },
      });

      await this.stock.recordSale(tx, {
        organizationId,
        invoiceId: created.id,
        userId,
        lines: items,
      });

      return created;
    });

    // 6. Gerar o boleto no provedor padrão do método
    const bankSlipRoute = routes.get('BANK_SLIP');

    if (bankSlip && bankSlipRoute) {
      try {
        await this.charges.createCharge({
          invoiceId: invoice.id,
          client,
          route: bankSlipRoute,
          request: {
            method: 'BANK_SLIP',
            value: bankSlip.value,
            dueDate: bankSlip.dueDate,
            description: invoice.description || DEFAULT_CHARGE_DESCRIPTION,
            discount: bankSlip.discount,
            fine: bankSlip.fine,
            interestPercent: bankSlip.interestPercent,
          },
          validUntil: null,
        });
      } catch (error) {
        this.logger.error(
          `Failed to create bank slip for invoice ${invoice.id}`,
          error,
        );

        // Sem boleto, a invoice não é mantida e o estoque volta
        await this.prisma.$transaction(async (tx) => {
          await this.stock.undoSale(tx, invoice.id);
          await tx.invoice.delete({ where: { id: invoice.id } });
        });

        throw toPaymentHttpException(error, 'Falha ao gerar o boleto');
      }
    }

    // A fatura (e o boleto) já estão gravados: o e-mail ao pagador sai com o link de pagamento
    this.eventEmitter.emit(INVOICE_ISSUED_EVENT, {
      invoiceId: invoice.id,
      organizationId,
    } satisfies InvoiceIssuedEvent);

    return this.findOne(invoice.id, organizationId);
  }

  async findAll(organizationId: string, query: ListInvoicesQueryDto) {
    const { page, limit } = query;
    const where: Prisma.InvoiceWhereInput = { organizationId };

    if (query.clientId) where.clientId = query.clientId;
    if (query.createdAt) where.createdAt = utcDayRange(query.createdAt);
    if (query.status)
      where.AND = [invoiceStatusWhere(query.status, todayInBillingTimezone())];
    if (query.hasExcess) where.excessValue = { gt: 0 };

    const [invoices, totalItems] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: INVOICE_SUMMARY_SELECT,
      }),
      this.prisma.invoice.count({ where }),
    ]);

    return {
      data: invoices.map((invoice) => this.toResponse(invoice)),
      meta: paginationMeta(page, limit, totalItems),
    };
  }

  /**
   * Totais pelo status exibido, da organização ou de um cliente. Em aberto (pendente a vencer e
   * aguardando a conferência de um comprovante) e vencido somam o valor nominal; pago soma o valor
   * recebido, e a paga sem ele registrado (anterior às cobranças) entra pelo nominal.
   */
  async totals(organizationId: string, clientId: string | null) {
    const today = todayInBillingTimezone();
    const scoped = (
      where: Prisma.InvoiceWhereInput,
    ): Prisma.InvoiceWhereInput => ({
      organizationId,
      ...(clientId ? { clientId } : {}),
      AND: [where],
    });
    const byStatus = (status: InvoiceStatus) =>
      scoped(invoiceStatusWhere(status, today));

    const [open, overdue, paid, paidWithoutValue] = await Promise.all([
      this.prisma.invoice.aggregate({
        where: scoped({
          OR: [
            invoiceStatusWhere(INVOICE_STATUS.PENDING, today),
            { status: INVOICE_STATUS.AWAITING_CONFIRMATION },
          ],
        }),
        _count: { _all: true },
        _sum: { totalValue: true },
      }),
      this.prisma.invoice.aggregate({
        where: byStatus(INVOICE_STATUS.OVERDUE),
        _count: { _all: true },
        _sum: { totalValue: true },
      }),
      this.prisma.invoice.aggregate({
        where: byStatus(INVOICE_STATUS.PAID),
        _count: { _all: true },
        _sum: { paidValue: true },
      }),
      this.prisma.invoice.aggregate({
        where: { ...byStatus(INVOICE_STATUS.PAID), paidValue: null },
        _sum: { totalValue: true },
      }),
    ]);

    return {
      open: {
        count: open._count._all,
        total: roundCurrency(open._sum.totalValue ?? 0),
      },
      overdue: {
        count: overdue._count._all,
        total: roundCurrency(overdue._sum.totalValue ?? 0),
      },
      paid: {
        count: paid._count._all,
        total: roundCurrency(
          (paid._sum.paidValue ?? 0) + (paidWithoutValue._sum.totalValue ?? 0),
        ),
      },
    };
  }

  /** Faturas com comprovante a conferir: o número no menu. */
  async awaitingConfirmationCount(organizationId: string) {
    const count = await this.prisma.invoice.count({
      where: {
        organizationId,
        status: INVOICE_STATUS.AWAITING_CONFIRMATION,
      },
    });

    return { count };
  }

  async findOne(id: string, organizationId: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, organizationId },
      select: INVOICE_DETAIL_SELECT,
    });

    if (!invoice) {
      throw new NotFoundException('Fatura não encontrada');
    }

    const { transactions, organization, ...rest } = invoice;
    const { totalPaid, totalRefunded, net, due, balance, excess } =
      computeInvoiceBalance(
        pricingRulesFromInvoice(invoice),
        transactions,
        todayInBillingTimezone(),
      );
    const locked = lockedMethod(transactions);
    // Formas em que o operador lança um pagamento recebido por fora nesta fatura
    const manualMethods: ManualPaymentMethod[] = MANUAL_PAYMENT_METHODS.filter(
      (method) =>
        rest.paymentMethods.includes(method) &&
        isManualMethodAvailable(organization, method) &&
        (!locked || locked === method),
    );

    return {
      ...this.toResponse(rest),
      transactions: transactions.map(toTransactionResponse),
      balance: { totalPaid, totalRefunded, net, due, balance, excess },
      manualMethods,
    };
  }

  /** Troca o token pelo link de pagamento e mostra como vencida a fatura pendente após o vencimento. */
  private toResponse<
    T extends { checkoutToken: string | null; status: string; dueDate: Date },
  >({ checkoutToken, ...invoice }: T) {
    return {
      ...invoice,
      status: displayInvoiceStatus(
        invoice.status,
        invoice.dueDate,
        todayInBillingTimezone(),
      ),
      checkoutUrl: checkoutUrl(checkoutToken),
    };
  }

  /** Token opaco da URL pública (192 bits): o id da fatura nunca vai na URL. */
  private generateCheckoutToken(): string {
    return randomBytes(24).toString('base64url');
  }

  /** Promoções da organização aplicadas aos itens (as de outra organização não vêm). */
  private async findIssuingPromotions(
    organizationId: string,
    discount: DiscountRules,
  ): Promise<IssuingPromotion[]> {
    const ids = [
      ...new Set(
        discount.items.flatMap((rule) =>
          rule.promotion ? [rule.promotion.id] : [],
        ),
      ),
    ];

    if (ids.length === 0) return [];

    const promotions = await this.prisma.promotion.findMany({
      where: { id: { in: ids }, organizationId },
      select: ISSUING_PROMOTION_SELECT,
    });

    return promotions.map(toIssuingPromotion);
  }

  private toDiscountRules(discount?: InvoiceDiscountDto): DiscountRules {
    return {
      items: (discount?.items ?? []).map((rule) => ({
        id: rule.id,
        type: rule.type,
        value: rule.value,
        promotion: rule.promotion
          ? {
              id: rule.promotion.id,
              name: rule.promotion.name,
              application: rule.promotion.application,
              maxAmount: rule.promotion.maxAmount ?? null,
              maxQuantity: rule.promotion.maxQuantity ?? null,
            }
          : null,
      })),
      methods: (discount?.methods ?? []).map((rule) => ({
        method: rule.method,
        type: rule.type,
        value: rule.value,
        limitDate: rule.limitDate ?? '',
      })),
    };
  }

  private toInterestAndFineRules(
    interestAndFine?: InterestAndFineDto,
  ): InterestAndFineRules {
    return {
      fineType: interestAndFine?.fineType ?? 'PERCENTAGE',
      fineValue: interestAndFine?.fineValue ?? 0,
      interestType: interestAndFine?.interestType ?? 'PERCENTAGE',
      interestValue: interestAndFine?.interestValue ?? 0,
    };
  }
}

/** Valor em número, data como YYYY-MM-DD e só a indicação de que há comprovante. */
function toTransactionResponse({
  amount,
  occurredAt,
  proofKey,
  chargeId: _chargeId,
  ...transaction
}: InvoiceTransactionRow) {
  return {
    ...transaction,
    amount: amount?.toNumber() ?? null,
    occurredAt: occurredAt ? paidDate(occurredAt) : null,
    hasProof: proofKey != null,
  };
}
