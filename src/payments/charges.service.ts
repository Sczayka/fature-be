import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  Client,
  InvoiceCharge,
  PaymentGatewayAccount,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import type { InvoicePaidEvent } from '../invoices/invoice-events.js';
import { INVOICE_STATUS } from '../invoices/invoices.constants.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PaymentCustomersService } from './payment-customers.service.js';
import type { PaymentRoute } from './payment-routing.service.js';
import { CHARGE_STATUS } from './payments.constants.js';
import { calcRateAmount, calcSplitAmount } from './pricing/fees.js';
import {
  CreateChargeInput,
  PaymentProviderError,
  ProviderCharge,
  ProviderChargeStatus,
} from './providers/payment-provider.js';
import { PaymentProviderRegistry } from './providers/payment-provider.registry.js';
import { InvoiceTransactionsService } from './transactions/invoice-transactions.service.js';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

/** O que a cobrança pede ao provedor; cliente, referência e split são resolvidos aqui. */
export type ChargeRequest = DistributiveOmit<
  CreateChargeInput,
  'customerExternalId' | 'reference' | 'splitAmount'
>;

export type ChargeDb = Pick<Prisma.TransactionClient, 'invoiceCharge'>;

export type ChargeWithAccount = InvoiceCharge & {
  paymentGatewayAccount: PaymentGatewayAccount;
};

export interface CreateChargeParams {
  invoiceId: string;
  client: Client;
  route: PaymentRoute;
  request: ChargeRequest;
  /** Último dia em que o valor calculado vale (cobranças geradas no checkout). */
  validUntil: string | null;
}

export interface CreatedCharge {
  record: InvoiceCharge;
  providerStatus: ProviderChargeStatus;
}

export interface PaymentConfirmation {
  paidAt: Date;
  paidValue: number;
  /** Comprovante do provedor, quando vem no evento de pagamento. */
  receiptUrl: string | null;
}

/** A transação segura a conexão durante a chamada ao provedor (cartão pode levar segundos). */
const INVOICE_LOCK_TIMEOUT_MS = 90_000;
const INVOICE_LOCK_MAX_WAIT_MS = 15_000;

/** Cobranças das faturas nos provedores (InvoiceCharge), qualquer que seja o provedor. */
@Injectable()
export class ChargesService {
  private readonly logger = new Logger(ChargesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly customers: PaymentCustomersService,
    private readonly registry: PaymentProviderRegistry,
    private readonly transactions: InvoiceTransactionsService,
  ) {}

  /**
   * Serializa as escritas de uma fatura (checkout e webhooks): duas requisições ao mesmo
   * tempo não geram duas cobranças nem confirmam o pagamento duas vezes.
   */
  withInvoiceLock<T>(
    invoiceId: string,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${invoiceId}))`;

        return work(tx);
      },
      { timeout: INVOICE_LOCK_TIMEOUT_MS, maxWait: INVOICE_LOCK_MAX_WAIT_MS },
    );
  }

  /**
   * Cria a cobrança no provedor da rota e grava a InvoiceCharge com o retrato da taxa, do
   * custo e do split. A referência enviada ao provedor é o id da InvoiceCharge, gerado antes
   * da chamada: uma cobrança cuja resposta se perdeu ainda é encontrada pela referência.
   */
  async createCharge(
    { invoiceId, client, route, request, validUntil }: CreateChargeParams,
    db: ChargeDb = this.prisma,
  ): Promise<CreatedCharge> {
    const id = randomUUID();
    const customerExternalId = await this.customers.ensureCustomer(
      route.account,
      client,
    );
    const feeAmount = calcRateAmount(route.fee, request.value);
    const costAmount = calcRateAmount(route.cost, request.value);
    const splitAmount = route.provider.capabilities.supportsSplit
      ? calcSplitAmount(feeAmount, costAmount)
      : 0;

    const charge = await this.requestCharge(route, {
      ...request,
      customerExternalId,
      reference: id,
      splitAmount,
    } as CreateChargeInput);

    const isPaid = charge.status === 'PAID';

    try {
      const record = await db.invoiceCharge.create({
        data: {
          id,
          invoiceId,
          method: request.method,
          paymentGatewayAccountId: route.account.id,
          externalId: charge.externalId,
          status: isPaid ? CHARGE_STATUS.PAID : CHARGE_STATUS.PENDING,
          value: request.value,
          dueDate: new Date(request.dueDate),
          validUntil: validUntil ? new Date(validUntil) : null,
          feeFixed: route.fee.fixed,
          feePercent: route.fee.percent,
          costFixed: route.cost.fixed,
          costPercent: route.cost.percent,
          feeAmount,
          costAmount,
          splitAmount,
          details: charge.details as unknown as Prisma.InputJsonObject,
          providerResponse: charge.raw as Prisma.InputJsonObject,
          paidAt: isPaid ? new Date() : null,
          paidValue: isPaid ? request.value : null,
        },
      });

      return { record, providerStatus: charge.status };
    } catch (error) {
      this.logger.error(
        `Cobrança ${charge.externalId} criada em ${route.provider.code}, mas não gravada (referência ${id})`,
        error,
      );
      throw error;
    }
  }

  /** Cancela uma cobrança aberta no provedor dela e a marca como cancelada. */
  async cancelCharge(db: ChargeDb, charge: ChargeWithAccount): Promise<void> {
    await this.registry
      .get(charge.paymentGatewayAccount.provider)
      .cancelCharge(charge.paymentGatewayAccount, charge.externalId);

    await db.invoiceCharge.update({
      where: { id: charge.id },
      data: { status: CHARGE_STATUS.CANCELLED },
    });
  }

  /**
   * Pagamento confirmado: a cobrança fica paga e vira uma transação da fatura, cuja situação é
   * recalculada (`InvoiceTransactionsService.applyBalance`). Quitada, as outras cobranças abertas
   * são canceladas nos seus provedores (best effort). Idempotente. Rode dentro do lock da fatura.
   *
   * Devolve o evento "fatura paga" só quando a fatura acabou de ser paga; quem chamou o emite
   * depois do commit (aqui ainda estamos dentro da transação).
   */
  async markPaid(
    tx: Prisma.TransactionClient,
    chargeId: string,
    { paidAt, paidValue, receiptUrl }: PaymentConfirmation,
  ): Promise<InvoicePaidEvent | null> {
    const charge = await tx.invoiceCharge.findUniqueOrThrow({
      where: { id: chargeId },
      include: { invoice: true },
    });
    const { invoice } = charge;
    const isNewPayment = charge.status !== CHARGE_STATUS.PAID;
    // O comprovante pode chegar num segundo evento (ex.: PAYMENT_RECEIVED depois do CONFIRMED)
    const details = withReceiptUrl(charge.details, receiptUrl);

    if (isNewPayment || details) {
      await tx.invoiceCharge.update({
        where: { id: charge.id },
        data: {
          ...(isNewPayment
            ? { status: CHARGE_STATUS.PAID, paidAt, paidValue }
            : {}),
          ...(details ? { details } : {}),
        },
      });
    }

    // O cartão aprovado na hora já nasce paga: a transação sai na primeira confirmação, e o
    // evento repetido encontra a que já existe
    const recorded = await this.transactions.recordGatewayPayment(tx, {
      invoiceId: invoice.id,
      chargeId: charge.id,
      method: charge.method,
      amount: isNewPayment ? paidValue : (charge.paidValue ?? paidValue),
      occurredAt: isNewPayment ? paidAt : (charge.paidAt ?? paidAt),
    });

    let status = invoice.status;
    let paid: InvoicePaidEvent | null = null;

    if (recorded.created) {
      ({ status, paidEvent: paid } = await this.transactions.applyBalance(
        tx,
        invoice.id,
      ));

      if (invoice.status === INVOICE_STATUS.PAID) {
        this.logger.warn(
          `Pagamento em duplicidade na fatura ${invoice.id}: excedente registrado nas movimentações`,
        );
      }
    }

    if (status === INVOICE_STATUS.PAID) {
      await this.cancelOpenCharges(tx, invoice.id, charge.id);
    }

    return paid;
  }

  /**
   * Cancela nos provedores as cobranças abertas da fatura quitada, menos a que pagou (null no
   * pagamento manual). Best effort: a falha fica só no log.
   */
  async cancelOpenCharges(
    db: ChargeDb,
    invoiceId: string,
    exceptChargeId: string | null,
  ): Promise<void> {
    const openCharges = await db.invoiceCharge.findMany({
      where: {
        invoiceId,
        status: CHARGE_STATUS.PENDING,
        ...(exceptChargeId ? { id: { not: exceptChargeId } } : {}),
      },
      include: { paymentGatewayAccount: true },
    });

    for (const openCharge of openCharges) {
      try {
        await this.cancelCharge(db, openCharge);
      } catch (error) {
        this.logger.error(
          `Cobrança ${openCharge.id} não cancelada após o pagamento da fatura ${invoiceId}`,
          error,
        );
      }
    }
  }

  /**
   * Cartão: se a resposta se perdeu (timeout), a cobrança pode ter sido criada e autorizada.
   * Antes de devolver o erro, procura pela referência para não cobrar o cartão de novo.
   */
  private async requestCharge(
    route: PaymentRoute,
    input: CreateChargeInput,
  ): Promise<ProviderCharge> {
    try {
      return await route.provider.createCharge(route.account, input);
    } catch (error) {
      const isLostCardResponse =
        input.method === 'CREDIT_CARD' &&
        error instanceof PaymentProviderError &&
        error.kind === 'UNAVAILABLE';

      if (!isLostCardResponse) throw error;

      const [found] = await route.provider
        .findChargesByReference(route.account, input.reference)
        .catch(() => []);

      if (!found) throw error;

      this.logger.warn(
        `Cobrança ${found.externalId} recuperada pela referência ${input.reference} após falha de comunicação`,
      );

      return found;
    }
  }
}

/** Detalhes da cobrança com o comprovante; null quando não há o que gravar. */
function withReceiptUrl(
  details: Prisma.JsonValue | null,
  receiptUrl: string | null,
): Prisma.InputJsonObject | null {
  if (!receiptUrl) return null;

  const current =
    details && typeof details === 'object' && !Array.isArray(details)
      ? details
      : {};

  if (current.receiptUrl === receiptUrl) return null;

  return { ...current, receiptUrl } as Prisma.InputJsonObject;
}
