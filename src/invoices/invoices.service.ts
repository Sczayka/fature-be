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
import { ChargesService } from '../payments/charges.service.js';
import { toPaymentHttpException } from '../payments/payment-errors.js';
import { PaymentRoutingService } from '../payments/payment-routing.service.js';
import { CreateInvoiceDto } from './dto/create-invoice.dto.js';
import {
  InterestAndFineDto,
  InvoiceDiscountDto,
} from './dto/invoice-sections.dto.js';
import { checkoutUrl } from './checkout-url.js';
import {
  INVOICE_ISSUED_EVENT,
  type InvoiceIssuedEvent,
} from './invoice-events.js';
import {
  DEFAULT_CHARGE_DESCRIPTION,
  PAYMENT_METHOD_LABELS,
} from './invoices.constants.js';
import { displayInvoiceStatus } from './invoice-status.js';
import { todayInBillingTimezone } from './pricing/dates.js';
import {
  DiscountRules,
  InterestAndFineRules,
  InvoicePricingRules,
  buildBankSlipCharge,
  calcNominalValue,
} from './pricing/invoice-pricing.js';
import { validateIssuingRules } from './pricing/invoice-rules.js';

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
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.InvoiceSelect;

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
} satisfies Prisma.InvoiceSelect;

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    private prisma: PrismaService,
    private routing: PaymentRoutingService,
    private charges: ChargesService,
    private eventEmitter: EventEmitter2,
  ) {}

  /**
   * Persiste a invoice e gera apenas o boleto (quando habilitado), no provedor padrão do
   * método para a organização. PIX e cartões são gerados no checkout, com valores calculados
   * pelo Fature a partir das regras salvas.
   */
  async create(organizationId: string, createInvoiceDto: CreateInvoiceDto) {
    const { billing, paymentMethods } = createInvoiceDto;
    const discount = this.toDiscountRules(createInvoiceDto.discount);
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

    // 1. Regras de emissão (antes de qualquer efeito colateral)
    const issues = validateIssuingRules(
      {
        clientId: createInvoiceDto.client.id ?? '',
        items,
        dueDate: billing.dueDate,
        paymentMethods,
        discount,
        interestAndFine,
      },
      todayInBillingTimezone(),
    );

    if (issues.length > 0) {
      throw new BadRequestException({
        message: issues[0].message,
        details: issues.map((issue) => `${issue.path}: ${issue.message}`),
      });
    }

    // 2. Cliente da organização
    const client = await this.prisma.client.findFirst({
      where: { id: createInvoiceDto.client.id, organizationId },
    });

    if (!client) {
      throw new NotFoundException('Cliente não encontrado');
    }

    // 3. Cada método habilitado precisa de um provedor disponível para a organização
    const routes = await this.routing.getRoutes(organizationId);
    const unavailable = paymentMethods.filter((method) => !routes.get(method));

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

    // 5. Persistir a invoice
    const invoice = await this.prisma.invoice.create({
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

        // Sem boleto, a invoice não é mantida
        await this.prisma.invoice.delete({ where: { id: invoice.id } });

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

  async findAll(
    organizationId: string,
    page: number = 1,
    limit: number = 10,
    filters?: { createdAt?: string },
  ) {
    const skip = (page - 1) * limit;

    const where: any = { organizationId };

    if (filters?.createdAt) {
      const date = new Date(filters.createdAt);
      if (!isNaN(date.getTime())) {
        const startOfDay = new Date(date);
        startOfDay.setUTCHours(0, 0, 0, 0);

        const endOfDay = new Date(date);
        endOfDay.setUTCHours(23, 59, 59, 999);

        where.createdAt = {
          gte: startOfDay,
          lte: endOfDay,
        };
      }
    }

    const [invoices, total_items] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: INVOICE_SUMMARY_SELECT,
      }),
      this.prisma.invoice.count({
        where,
      }),
    ]);

    const total_pages = Math.ceil(total_items / limit);

    return {
      data: invoices.map((invoice) => this.toResponse(invoice)),
      meta: {
        page,
        per_page: limit,
        total_items,
        total_pages,
        has_next: page < total_pages,
        has_previous: page > 1,
      },
    };
  }

  async findOne(id: string, organizationId: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, organizationId },
      select: INVOICE_DETAIL_SELECT,
    });

    if (!invoice) {
      throw new NotFoundException('Fatura não encontrada');
    }

    return this.toResponse(invoice);
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

  private toDiscountRules(discount?: InvoiceDiscountDto): DiscountRules {
    return {
      items: (discount?.items ?? []).map((rule) => ({
        id: rule.id,
        type: rule.type,
        value: rule.value,
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
