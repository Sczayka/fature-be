import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { InvoiceCharge } from '@prisma/client';
import { displayInvoiceStatus } from '../invoices/invoice-status.js';
import {
  DEFAULT_CHARGE_DESCRIPTION,
  INVOICE_STATUS,
  InvoiceStatus,
} from '../invoices/invoices.constants.js';
import { todayInBillingTimezone } from '../invoices/pricing/dates.js';
import {
  InvoicePricingRules,
  InvoiceQuote,
  calcItemDiscount,
  getQuote,
  pricingRulesFromInvoice,
} from '../invoices/pricing/invoice-pricing.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ChargesService } from '../payments/charges.service.js';
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
import type {
  CardPaymentResult,
  CheckoutOption,
  CheckoutPix,
  CheckoutQuote,
  CheckoutStatus,
  CheckoutView,
} from './checkout.types.js';
import { PayWithCreditCardDto } from './dto/pay-with-credit-card.dto.js';

/** Formato do token gerado na emissão (24 bytes em base64url). */
const CHECKOUT_TOKEN_PATTERN = /^[\w-]{32}$/;

const PAYABLE_STATUSES: InvoiceStatus[] = [
  INVOICE_STATUS.PENDING,
  INVOICE_STATUS.OVERDUE,
];

const checkoutInclude = {
  organization: { select: { name: true, logo: true } },
  client: true,
  charges: {
    where: { status: CHARGE_STATUS.PENDING },
    include: { paymentGatewayAccount: true },
    orderBy: { createdAt: 'desc' },
  },
} satisfies Prisma.InvoiceInclude;

type CheckoutInvoice = Prisma.InvoiceGetPayload<{
  include: typeof checkoutInclude;
}>;

interface StoredItem {
  id: string;
  name: string;
  quantity: number;
  total: number;
}

/**
 * Página pública de pagamento. Os valores são sempre os do dia, calculados pelo Fature; as
 * cobranças vão para o provedor padrão de cada método (núcleo de pagamentos).
 */
@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly routing: PaymentRoutingService,
    private readonly charges: ChargesService,
  ) {}

  async getView(token: string): Promise<CheckoutView> {
    const invoice = await this.findByToken(token);
    const today = todayInBillingTimezone();
    const status = displayInvoiceStatus(invoice.status, invoice.dueDate, today);
    const rules = pricingRulesFromInvoice(invoice);

    return {
      status,
      issuer: invoice.organization,
      customerName: invoice.client.name,
      description: invoice.description,
      dueDate: rules.dueDate,
      items: (invoice.items as unknown as StoredItem[]).map(
        ({ id, name, quantity, total }) => ({
          name,
          quantity,
          total,
          discount: calcItemDiscount(rules, { id, total }),
        }),
      ),
      nominalValue: invoice.totalValue,
      payment: invoice.paidAt
        ? {
            paidAt: invoice.paidAt.toISOString(),
            method: invoice.paidMethod as PaymentMethod | null,
            value: invoice.paidValue,
          }
        : null,
      options: PAYABLE_STATUSES.includes(status)
        ? await this.buildOptions(invoice, rules, today)
        : [],
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
    const { id } = await this.findByToken(token);

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

    return this.charges.withInvoiceLock(id, async (tx) => {
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

      if (created.providerStatus !== 'PAID') return { status: 'IN_ANALYSIS' };

      await this.charges.markPaid(tx, created.record.id, {
        paidAt: new Date(),
        paidValue: quote.total,
      });

      return { status: 'PAID' };
    });
  }

  private async buildOptions(
    invoice: CheckoutInvoice,
    rules: InvoicePricingRules,
    today: string,
  ): Promise<CheckoutOption[]> {
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
        const route = routes.get('PIX');
        const openPix = this.openCharge(invoice, 'PIX');

        if (route) {
          options.push({
            method,
            quote: this.toQuote(quote),
            pix:
              openPix && this.isReusable(openPix, quote, route, today)
                ? this.toPix(openPix)
                : null,
          });
        }
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

  /** Recarrega a fatura dentro do lock e confere se ela ainda aceita o pagamento. */
  private async loadPayable(
    tx: Prisma.TransactionClient,
    invoiceId: string,
    method: PaymentMethod,
  ): Promise<CheckoutInvoice> {
    const invoice = await tx.invoice.findUniqueOrThrow({
      where: { id: invoiceId },
      include: checkoutInclude,
    });

    if (invoice.status === INVOICE_STATUS.PAID) {
      throw new ConflictException('Esta fatura já foi paga');
    }

    if (invoice.status === INVOICE_STATUS.CANCELLED) {
      throw new ConflictException('Esta fatura foi cancelada');
    }

    if (!invoice.paymentMethods.includes(method)) {
      throw new BadRequestException(
        'Forma de pagamento não habilitada nesta fatura',
      );
    }

    return invoice;
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
