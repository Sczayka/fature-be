import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import type { InvoiceCharge } from '@prisma/client';
import { randomUUID } from 'crypto';
import {
  INVOICE_PAID_EVENT,
  PAYMENT_PROOF_RECEIVED_EVENT,
  type InvoicePaidEvent,
  type InvoiceTransactionEvent,
} from '../invoices/invoice-events.js';
import { displayInvoiceStatus } from '../invoices/invoice-status.js';
import {
  DEFAULT_CHARGE_DESCRIPTION,
  INVOICE_STATUS,
} from '../invoices/invoices.constants.js';
import { paidDate, todayInBillingTimezone } from '../invoices/pricing/dates.js';
import {
  InvoicePricingRules,
  InvoiceQuote,
  calcItemDiscount,
  getQuote,
  pricingRulesFromInvoice,
} from '../invoices/pricing/invoice-pricing.js';
import type { Wallpaper } from '../organizations/customization/customization.constants.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ChargesService } from '../payments/charges.service.js';
import {
  MANUAL_PAYMENT_CONFIG_SELECT,
  canReceiveBankTransfer,
  isManualMethodAvailable,
  isManualPixMode,
  lockedMethodMessage,
  usesManualPix,
} from '../payments/manual/manual-payment-config.js';
import {
  MAX_PENDING_RECEIPTS,
  PIX_MERCHANT_CITY,
  PIX_STATIC_TXID,
  isManualPaymentMethod,
  type ManualPaymentMethod,
} from '../payments/manual/manual-payments.constants.js';
import {
  buildStaticPixPayload,
  pixQrCodeImage,
} from '../payments/manual/pix-br-code.js';
import { toPaymentHttpException } from '../payments/payment-errors.js';
import {
  PaymentRoute,
  PaymentRoutingService,
} from '../payments/payment-routing.service.js';
import {
  CHARGE_STATUS,
  PAYMENT_METHODS,
  PaymentMethod,
} from '../payments/payments.constants.js';
import type {
  CardPayment,
  ChargeDetails,
} from '../payments/providers/payment-provider.js';
import {
  InvoiceBalance,
  computeInvoiceBalance,
  lockedMethod,
} from '../payments/transactions/invoice-balance.js';
import { InvoiceTransactionsService } from '../payments/transactions/invoice-transactions.service.js';
import {
  BALANCE_TRANSACTION_SELECT,
  TRANSACTION_SOURCE,
  TRANSACTION_STATUS,
  TRANSACTION_TYPE,
  type TransactionStatus,
} from '../payments/transactions/transactions.constants.js';
import {
  type UploadedProof,
  proofFields,
  proofObjectKey,
} from '../storage/proof-file.js';
import { StorageService } from '../storage/storage.service.js';
import type {
  BankAccountType,
  PixKeyType,
} from '../suppliers/suppliers.constants.js';
import type {
  CardPaymentResult,
  CheckoutOption,
  CheckoutPix,
  CheckoutQuote,
  CheckoutReceipt,
  CheckoutStatus,
  CheckoutView,
} from './checkout.types.js';
import { PayWithCreditCardDto } from './dto/pay-with-credit-card.dto.js';

/** Formato do token gerado na emissão (24 bytes em base64url). */
const CHECKOUT_TOKEN_PATTERN = /^[\w-]{32}$/;

const PAYABLE_STATUSES: string[] = [
  INVOICE_STATUS.PENDING,
  INVOICE_STATUS.OVERDUE,
  INVOICE_STATUS.AWAITING_CONFIRMATION,
];

const checkoutInclude = {
  organization: {
    select: {
      name: true,
      logo: true,
      wallpaper: true,
      backgroundColor: true,
      buttonColor: true,
      ...MANUAL_PAYMENT_CONFIG_SELECT,
    },
  },
  client: true,
  charges: {
    where: { status: CHARGE_STATUS.PENDING },
    include: { paymentGatewayAccount: true },
    orderBy: { createdAt: 'desc' },
  },
  // Saldo, forma travada e os comprovantes do pagamento manual
  transactions: {
    select: {
      ...BALANCE_TRANSACTION_SELECT,
      statusReason: true,
      proofName: true,
      proofKey: true,
    },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.InvoiceInclude;

type CheckoutInvoice = Prisma.InvoiceGetPayload<{
  include: typeof checkoutInclude;
}>;

type CheckoutTransaction = CheckoutInvoice['transactions'][number];

interface StoredItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  total: number;
}

/**
 * Página pública de pagamento. Os valores são sempre os do dia, calculados pelo Fature; as
 * cobranças vão para o provedor padrão de cada método (núcleo de pagamentos). Transferência e PIX
 * manual são pagos por fora, com o comprovante conferido pela empresa.
 */
@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly routing: PaymentRoutingService,
    private readonly charges: ChargesService,
    private readonly transactions: InvoiceTransactionsService,
    private readonly storage: StorageService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async getView(token: string): Promise<CheckoutView> {
    const invoice = await this.findByToken(token);
    const today = todayInBillingTimezone();
    const status = displayInvoiceStatus(invoice.status, invoice.dueDate, today);
    const rules = pricingRulesFromInvoice(invoice);
    const balance = computeInvoiceBalance(rules, invoice.transactions, today);
    const locked = lockedMethod(invoice.transactions);
    const { name, logo, wallpaper, backgroundColor, buttonColor } =
      invoice.organization;

    return {
      status,
      issuer: { name, logo },
      theme: {
        wallpaper: wallpaper as Wallpaper | null,
        backgroundColor,
        buttonColor,
      },
      customerName: invoice.client.name,
      description: invoice.description,
      dueDate: rules.dueDate,
      items: (invoice.items as unknown as StoredItem[]).map((item) => ({
        name: item.name,
        quantity: item.quantity,
        total: item.total,
        discount: calcItemDiscount(rules, item),
        promotionName:
          rules.discount.items.find((rule) => rule.id === item.id)?.promotion
            ?.name ?? null,
      })),
      nominalValue: invoice.totalValue,
      payment: invoice.paidAt
        ? {
            paidAt: invoice.paidAt.toISOString(),
            method: invoice.paidMethod as PaymentMethod | null,
            value: invoice.paidValue,
          }
        : null,
      options: PAYABLE_STATUSES.includes(status)
        ? await this.buildOptions(invoice, rules, today, balance, locked)
        : [],
      receipts: invoice.transactions.filter(isReceipt).map(toReceipt),
      balance: {
        due: balance.due,
        received: balance.net,
        balance: balance.balance,
      },
      lockedMethod: isManualPaymentMethod(locked) ? locked : null,
    };
  }

  async getStatus(token: string): Promise<CheckoutStatus> {
    const invoice = await this.findByToken(token);

    return {
      status: displayInvoiceStatus(
        invoice.status,
        invoice.dueDate,
        todayInBillingTimezone(),
      ),
      paidAt: invoice.paidAt?.toISOString() ?? null,
      paidMethod: invoice.paidMethod as PaymentMethod | null,
    };
  }

  /** PIX pelo valor do dia: reaproveita o QR Code em aberto enquanto o valor dele vale. */
  async createPix(token: string): Promise<CheckoutPix> {
    const { id, organization } = await this.findByToken(token);

    // No modo manual, o PIX nunca passa pelo provedor
    if (isManualPixMode(organization)) {
      throw new BadRequestException(
        'O PIX desta fatura é pago com a chave da empresa e o envio do comprovante.',
      );
    }

    return this.charges.withInvoiceLock(id, async (tx) => {
      const invoice = await this.loadPayable(tx, id, 'PIX');
      const route = await this.requireRoute(invoice, 'PIX');
      const today = todayInBillingTimezone();
      const quote = getQuote(pricingRulesFromInvoice(invoice), 'PIX', today);
      const openPix = this.openCharge(invoice, 'PIX');

      if (openPix && this.isReusable(openPix, quote, route, today))
        return this.toPix(openPix);

      if (openPix) {
        try {
          await this.charges.cancelCharge(tx, openPix);
        } catch (error) {
          // O QR Code anterior pode ter acabado de ser pago: o webhook confirma em instantes
          this.logger.error(`PIX ${openPix.id} não substituído`, error);
          throw new ConflictException(
            'Não foi possível atualizar o PIX desta fatura. Tente novamente em instantes.',
          );
        }
      }

      try {
        const { record } = await this.charges.createCharge(
          {
            invoiceId: invoice.id,
            client: invoice.client,
            route,
            request: {
              method: 'PIX',
              value: quote.total,
              dueDate: quote.validUntil,
              description: this.chargeDescription(invoice),
            },
            validUntil: quote.validUntil,
          },
          tx,
        );

        return this.toPix(record);
      } catch (error) {
        throw toPaymentHttpException(error, 'Falha ao gerar o PIX');
      }
    });
  }

  /** Cartão pelo valor do dia; aprovado na hora, a fatura é confirmada como paga. */
  async payWithCreditCard(
    token: string,
    dto: PayWithCreditCardDto,
    payerIp: string,
  ): Promise<CardPaymentResult> {
    const { id } = await this.findByToken(token);

    const { result, paid } = await this.charges.withInvoiceLock(
      id,
      async (
        tx,
      ): Promise<{
        result: CardPaymentResult;
        paid: InvoicePaidEvent | null;
      }> => {
        const invoice = await this.loadPayable(tx, id, 'CREDIT_CARD');
        const route = await this.requireRoute(invoice, 'CREDIT_CARD');

        if (route.provider.capabilities.cardCapture !== dto.mode) {
          throw new BadRequestException(
            'A forma de pagamento com cartão mudou. Recarregue a página.',
          );
        }

        const today = todayInBillingTimezone();
        const quote = getQuote(
          pricingRulesFromInvoice(invoice),
          'CREDIT_CARD',
          today,
        );
        const payment: CardPayment =
          dto.mode === 'RAW'
            ? { mode: 'RAW', card: dto.card!, holder: dto.holder }
            : { mode: 'PROVIDER_TOKEN', token: dto.token!, holder: dto.holder };

        let created: Awaited<ReturnType<ChargesService['createCharge']>>;

        try {
          created = await this.charges.createCharge(
            {
              invoiceId: invoice.id,
              client: invoice.client,
              route,
              request: {
                method: 'CREDIT_CARD',
                value: quote.total,
                dueDate: today,
                description: this.chargeDescription(invoice),
                payment,
                payerIp,
              },
              validUntil: null,
            },
            tx,
          );
        } catch (error) {
          throw toPaymentHttpException(error, 'Falha no pagamento');
        }

        if (created.providerStatus !== 'PAID') {
          return { result: { status: 'IN_ANALYSIS' }, paid: null };
        }

        // O comprovante do cartão aprovado já ficou nos detalhes da cobrança criada; a data de
        // crédito chega depois, no evento do provedor
        const paid = await this.charges.markPaid(tx, created.record.id, {
          paidAt: new Date(),
          paidValue: quote.total,
          creditDate: null,
          receiptUrl: null,
        });

        return { result: { status: 'PAID' }, paid };
      },
    );

    // Depois do commit: se a transação falhar, o e-mail de pagamento não sai
    if (paid) this.eventEmitter.emit(INVOICE_PAID_EVENT, paid);

    return result;
  }

  /**
   * Comprovante de transferência ou de PIX manual: vira um pagamento aguardando a conferência da
   * empresa, sem valor nem data. O arquivo vai para o armazenamento antes da gravação (a chave usa
   * o id da transação) e é apagado se a gravação falhar.
   */
  async uploadReceipt(
    token: string,
    method: ManualPaymentMethod,
    file: UploadedProof,
  ): Promise<CheckoutView> {
    const invoice = await this.findByToken(token);

    // Antes do upload, para não subir arquivo à toa; de novo dentro do lock
    this.assertCanSendReceipt(invoice, method);

    const id = randomUUID();
    const key = proofObjectKey(
      invoice.organizationId,
      invoice.id,
      id,
      file.mimetype,
    );

    await this.storage.put(key, file.buffer, file.mimetype);

    try {
      await this.charges.withInvoiceLock(invoice.id, async (tx) => {
        const current = await tx.invoice.findUniqueOrThrow({
          where: { id: invoice.id },
          include: checkoutInclude,
        });

        this.assertCanSendReceipt(current, method);

        await tx.invoiceTransaction.create({
          data: {
            id,
            invoiceId: invoice.id,
            type: TRANSACTION_TYPE.PAYMENT,
            method,
            amount: null,
            occurredAt: null,
            status: TRANSACTION_STATUS.PENDING_REVIEW,
            source: TRANSACTION_SOURCE.CHECKOUT,
            ...proofFields(file, key),
          },
        });

        await this.transactions.applyBalance(tx, invoice.id);
      });
    } catch (error) {
      await this.storage
        .delete(key)
        .catch((deleteError: unknown) =>
          this.logger.error(
            `Comprovante ${key} não apagado após falha no envio pelo pagador`,
            deleteError,
          ),
        );

      throw error;
    }

    // Depois do commit: a empresa só é avisada do comprovante gravado
    this.eventEmitter.emit(PAYMENT_PROOF_RECEIVED_EVENT, {
      invoiceId: invoice.id,
      organizationId: invoice.organizationId,
      transactionId: id,
    } satisfies InvoiceTransactionEvent);

    return this.getView(token);
  }

  /** O pagador remove um comprovante enviado por engano, enquanto ele não foi conferido. */
  async removeReceipt(
    token: string,
    transactionId: string,
  ): Promise<CheckoutView> {
    const { id: invoiceId } = await this.findByToken(token);

    const proofKey = await this.charges.withInvoiceLock(
      invoiceId,
      async (tx) => {
        const transaction = await tx.invoiceTransaction.findFirst({
          where: { id: transactionId, invoiceId },
          select: { id: true, source: true, status: true, proofKey: true },
        });

        if (!transaction) {
          throw new NotFoundException('Comprovante não encontrado');
        }

        if (
          transaction.source !== TRANSACTION_SOURCE.CHECKOUT ||
          transaction.status !== TRANSACTION_STATUS.PENDING_REVIEW
        ) {
          throw new ConflictException(
            'Este comprovante já foi conferido e não pode ser removido.',
          );
        }

        await tx.invoiceTransaction.delete({ where: { id: transaction.id } });
        await this.transactions.applyBalance(tx, invoiceId);

        return transaction.proofKey;
      },
    );

    // Depois do commit: o arquivo só sai quando a transação já não existe
    if (proofKey) {
      await this.storage
        .delete(proofKey)
        .catch((error: unknown) =>
          this.logger.error(
            `Comprovante ${proofKey} não apagado após a remoção pelo pagador`,
            error,
          ),
        );
    }

    return this.getView(token);
  }

  /** URL assinada e temporária de um comprovante enviado pelo pagador. */
  async receiptFileUrl(token: string, transactionId: string): Promise<string> {
    const { id: invoiceId } = await this.findByToken(token);
    const transaction = await this.prisma.invoiceTransaction.findFirst({
      where: {
        id: transactionId,
        invoiceId,
        source: TRANSACTION_SOURCE.CHECKOUT,
      },
      select: { proofKey: true, proofMimeType: true, proofName: true },
    });

    if (!transaction?.proofKey) {
      throw new NotFoundException('Comprovante não encontrado');
    }

    return this.storage.getSignedUrl(transaction.proofKey, {
      contentType: transaction.proofMimeType ?? 'application/octet-stream',
      fileName: transaction.proofName ?? 'comprovante',
    });
  }

  private async buildOptions(
    invoice: CheckoutInvoice,
    rules: InvoicePricingRules,
    today: string,
    balance: InvoiceBalance,
    locked: PaymentMethod | null,
  ): Promise<CheckoutOption[]> {
    const config = invoice.organization;

    // Forma manual já usada: só ela continua, porque o desconto pode ser diferente entre as formas
    if (locked) {
      const option =
        isManualPaymentMethod(locked) &&
        invoice.paymentMethods.includes(locked) &&
        isManualMethodAvailable(config, locked)
          ? await this.manualOption(
              invoice,
              locked,
              getQuote(rules, locked, today),
              balance.net > 0 ? balance.balance : null,
            )
          : null;

      return option ? [option] : [];
    }

    const routes = await this.routing.getRoutes(invoice.organizationId);
    const options: CheckoutOption[] = [];

    for (const method of PAYMENT_METHODS) {
      if (!invoice.paymentMethods.includes(method)) continue;

      const quote = getQuote(rules, method, today);

      if (method === 'BANK_SLIP') {
        // O boleto é gerado na emissão e continua no provedor em que foi criado
        const bankSlip = this.openCharge(invoice, 'BANK_SLIP');
        const details = bankSlip?.details as ChargeDetails | null;

        if (bankSlip) {
          options.push({
            method,
            quote: this.toQuote(quote),
            bankSlip: {
              url: details?.bankSlipUrl ?? details?.invoiceUrl ?? null,
              identificationField: details?.identificationField ?? null,
            },
          });
        }
      }

      if (method === 'PIX') {
        // No modo manual, o PIX nunca passa pelo provedor; sem a chave, a opção não aparece
        if (isManualPixMode(config)) {
          if (usesManualPix(config)) {
            options.push(await this.manualOption(invoice, method, quote, null));
          }
        } else {
          const route = routes.get('PIX');
          const openPix = this.openCharge(invoice, 'PIX');

          if (route) {
            options.push({
              method,
              mode: 'AUTOMATIC',
              quote: this.toQuote(quote),
              pix:
                openPix && this.isReusable(openPix, quote, route, today)
                  ? this.toPix(openPix)
                  : null,
            });
          }
        }
      }

      if (method === 'BANK_TRANSFER' && canReceiveBankTransfer(config)) {
        options.push(await this.manualOption(invoice, method, quote, null));
      }

      if (method === 'CREDIT_CARD') {
        const route = routes.get('CREDIT_CARD');
        const capture = route?.provider.capabilities.cardCapture;

        if (route && capture) {
          options.push({
            method,
            quote: this.toQuote(quote),
            cardCapture:
              capture === 'RAW'
                ? { mode: 'RAW' }
                : { mode: 'PROVIDER_TOKEN', provider: route.provider.code },
          });
        }
      }
    }

    return options;
  }

  /**
   * Opção de uma forma manual, com os dados da conta da empresa. O valor é o de hoje; com
   * pagamento já confirmado nessa forma, é o saldo que falta (`remaining`).
   */
  private async manualOption(
    invoice: CheckoutInvoice,
    method: ManualPaymentMethod,
    quote: InvoiceQuote,
    remaining: number | null,
  ): Promise<CheckoutOption> {
    // A disponibilidade da forma (canReceiveBankTransfer, usesManualPix) já conferiu os campos
    const account = invoice.organization.bankAccount!;
    const value = remaining ?? quote.total;

    if (method === 'BANK_TRANSFER') {
      return {
        method,
        quote: this.toQuote(quote),
        bankTransfer: {
          bankCode: account.bankCode!,
          bankName: account.bankName,
          branch: account.branch!,
          accountNumber: account.accountNumber!,
          accountType: account.accountType as BankAccountType,
          holderName: account.holderName!,
          holderDocument: account.holderDocument!,
          value,
        },
      };
    }

    // Só o PIX manual liberado pode não ter o titular: vale o nome da empresa
    const holderName = account.holderName || invoice.organization.name;
    const payload = buildStaticPixPayload({
      key: account.pixKey!,
      merchantName: holderName,
      merchantCity: PIX_MERCHANT_CITY,
      amount: value,
      txid: PIX_STATIC_TXID,
    });

    return {
      method,
      mode: 'MANUAL',
      quote: this.toQuote(quote),
      manualPix: {
        keyType: account.pixKeyType as PixKeyType,
        key: account.pixKey!,
        holderName,
        value,
        payload,
        qrCodeImage: await pixQrCodeImage(payload),
      },
    };
  }

  private async findByToken(token: string): Promise<CheckoutInvoice> {
    const invoice = CHECKOUT_TOKEN_PATTERN.test(token)
      ? await this.prisma.invoice.findUnique({
          where: { checkoutToken: token },
          include: checkoutInclude,
        })
      : null;

    if (!invoice) {
      throw new NotFoundException('Fatura não encontrada');
    }

    return invoice;
  }

  /**
   * Recarrega a fatura dentro do lock e confere se ela ainda aceita o pagamento pelo provedor:
   * a fatura que já está sendo paga por uma forma manual só aceita essa forma.
   */
  private async loadPayable(
    tx: Prisma.TransactionClient,
    invoiceId: string,
    method: PaymentMethod,
  ): Promise<CheckoutInvoice> {
    const invoice = await tx.invoice.findUniqueOrThrow({
      where: { id: invoiceId },
      include: checkoutInclude,
    });

    this.assertPayableStatus(invoice.status);

    if (!invoice.paymentMethods.includes(method)) {
      throw new BadRequestException(
        'Forma de pagamento não habilitada nesta fatura',
      );
    }

    const locked = lockedMethod(invoice.transactions);

    if (locked) {
      throw new ConflictException(lockedMethodMessage(locked));
    }

    return invoice;
  }

  private assertPayableStatus(status: string): void {
    if (PAYABLE_STATUSES.includes(status)) return;

    throw new ConflictException(
      status === INVOICE_STATUS.PAID
        ? 'Esta fatura já foi paga'
        : 'Esta fatura foi cancelada',
    );
  }

  /** Regras do envio de comprovante: conferidas antes do upload e de novo dentro do lock. */
  private assertCanSendReceipt(
    invoice: CheckoutInvoice,
    method: ManualPaymentMethod,
  ): void {
    this.assertPayableStatus(invoice.status);

    if (
      !invoice.paymentMethods.includes(method) ||
      !isManualMethodAvailable(invoice.organization, method)
    ) {
      throw new BadRequestException(
        'Forma de pagamento não habilitada nesta fatura',
      );
    }

    const locked = lockedMethod(invoice.transactions);

    if (locked && locked !== method) {
      throw new ConflictException(lockedMethodMessage(locked));
    }

    const pending = invoice.transactions.filter(
      (row) => row.status === TRANSACTION_STATUS.PENDING_REVIEW,
    ).length;

    if (pending >= MAX_PENDING_RECEIPTS) {
      throw new ConflictException(
        'Aguarde a conferência dos comprovantes enviados.',
      );
    }
  }

  private async requireRoute(
    invoice: CheckoutInvoice,
    method: PaymentMethod,
  ): Promise<PaymentRoute> {
    const route = await this.routing.resolve(invoice.organizationId, method);

    if (!route) {
      throw new BadRequestException(
        'Forma de pagamento indisponível no momento',
      );
    }

    return route;
  }

  private openCharge(invoice: CheckoutInvoice, method: PaymentMethod) {
    // As cobranças vêm só as abertas, da mais nova para a mais antiga
    return invoice.charges.find((charge) => charge.method === method) ?? null;
  }

  /** O PIX aberto serve enquanto vale, tem o valor de hoje e está no provedor padrão. */
  private isReusable(
    charge: InvoiceCharge,
    quote: InvoiceQuote,
    route: PaymentRoute,
    today: string,
  ): boolean {
    const validUntil = charge.validUntil?.toISOString().slice(0, 10);
    const details = charge.details as ChargeDetails | null;

    return (
      !!validUntil &&
      validUntil >= today &&
      charge.value === quote.total &&
      charge.paymentGatewayAccountId === route.account.id &&
      !!details?.pixPayload
    );
  }

  private toPix(charge: InvoiceCharge): CheckoutPix {
    const details = charge.details as ChargeDetails | null;

    return {
      value: charge.value,
      validUntil: (charge.validUntil ?? charge.dueDate)
        .toISOString()
        .slice(0, 10),
      payload: details?.pixPayload ?? '',
      qrCodeImage: details?.pixQrCodeImage ?? '',
      expiresAt: details?.pixExpiresAt ?? null,
    };
  }

  private toQuote(quote: InvoiceQuote): CheckoutQuote {
    return {
      total: quote.total,
      phase: quote.phase,
      nominalValue: quote.nominalValue,
      methodDiscount: quote.methodDiscount,
      discountUntil: quote.methodDiscount > 0 ? quote.validUntil : null,
      fine: quote.fine,
      interest: quote.interest,
      daysLate: quote.daysLate,
    };
  }

  private chargeDescription(invoice: CheckoutInvoice): string {
    return invoice.description || DEFAULT_CHARGE_DESCRIPTION;
  }
}

/** Pagamentos do pagamento manual, do pagador ou da empresa; os do provedor ficam de fora. */
function isReceipt(row: CheckoutTransaction): boolean {
  return (
    row.type === TRANSACTION_TYPE.PAYMENT &&
    (row.source === TRANSACTION_SOURCE.CHECKOUT ||
      row.source === TRANSACTION_SOURCE.OPERATOR)
  );
}

/**
 * O pagador vê só o motivo da recusa (o do cancelamento é interno) e abre só o arquivo que ele
 * mesmo enviou.
 */
function toReceipt(row: CheckoutTransaction): CheckoutReceipt {
  return {
    id: row.id,
    method: row.method as ManualPaymentMethod,
    status: row.status as TransactionStatus,
    amount: row.amount?.toNumber() ?? null,
    occurredAt: row.occurredAt ? paidDate(row.occurredAt) : null,
    statusReason:
      row.status === TRANSACTION_STATUS.REJECTED ? row.statusReason : null,
    fileName: row.source === TRANSACTION_SOURCE.CHECKOUT ? row.proofName : null,
    createdAt: row.createdAt.toISOString(),
  };
}
