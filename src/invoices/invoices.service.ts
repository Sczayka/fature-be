import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { Invoice, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AsaasService } from '../asaas/asaas.service.js';
import { CreateInvoiceDto } from './dto/create-invoice.dto.js';
import {
  InterestAndFineDto,
  InvoiceDiscountDto,
} from './dto/invoice-sections.dto.js';
import { DEFAULT_CHARGE_DESCRIPTION } from './invoices.constants.js';
import { todayInBillingTimezone } from './pricing/dates.js';
import {
  BankSlipCharge,
  DiscountRules,
  InterestAndFineRules,
  InvoicePricingRules,
  buildBankSlipCharge,
  calcNominalValue,
} from './pricing/invoice-pricing.js';
import { validateIssuingRules } from './pricing/invoice-rules.js';

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    private prisma: PrismaService,
    private asaasService: AsaasService,
  ) {}

  /**
   * Persiste a invoice e gera apenas o boleto (quando habilitado). PIX e cartões ficam
   * com `null` em `paymentMethods` e serão gerados no checkout, com valores calculados
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

    // 2. Cliente da organização sincronizado com o Asaas
    const client = await this.prisma.client.findFirst({
      where: { id: createInvoiceDto.client.id, organizationId },
    });

    if (!client) {
      throw new NotFoundException('Cliente não encontrado');
    }

    const asaasCustomerId = (client.metadata as any)?.asaas?.id;

    if (!asaasCustomerId) {
      throw new BadRequestException(
        'O cliente precisa estar sincronizado com o Asaas para emitir cobranças',
      );
    }

    // 3. Conta do gateway da organização
    const gatewayAccount = await this.prisma.paymentGatewayAccount.findUnique({
      where: {
        organizationId_provider: {
          organizationId,
          provider: 'ASAAS',
        },
      },
    });

    if (!gatewayAccount || !gatewayAccount.metadata) {
      throw new BadRequestException(
        'Conta do Asaas não configurada para esta organização',
      );
    }

    const encryptedApiKey = (gatewayAccount.metadata as any).apiKey;
    if (!encryptedApiKey) {
      throw new BadRequestException('Conta do Asaas sem chave de API');
    }

    // 4. Valores calculados pelo Fature (o boleto é o único método gerado agora)
    const pricingRules: InvoicePricingRules = {
      items,
      dueDate: billing.dueDate,
      discount,
      interestAndFine,
    };
    const bankSlipCharge = paymentMethods.includes('BANK_SLIP')
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
        paymentMethods: Object.fromEntries(
          paymentMethods.map((method) => [method, null]),
        ),
        discount: discount as unknown as Prisma.InputJsonObject,
        interestAndFine: interestAndFine as unknown as Prisma.InputJsonObject,
        gatewayIds: [],
        paymentGatewayAccountId: gatewayAccount.id,
      },
    });

    if (!bankSlipCharge) {
      return invoice;
    }

    // 6. Gerar o boleto no Asaas
    return this.generateBankSlip(invoice, bankSlipCharge, {
      asaasCustomerId,
      subaccountApiKey: this.asaasService.decryptApiKey(encryptedApiKey),
    });
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

    const [data, total_items] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        // Dados do provedor (meta) e chaves internas ficam fora da listagem
        select: {
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
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.invoice.count({
        where,
      }),
    ]);

    const total_pages = Math.ceil(total_items / limit);

    return {
      data,
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

  private async generateBankSlip(
    invoice: Invoice,
    charge: BankSlipCharge,
    gateway: { asaasCustomerId: string; subaccountApiKey: string },
  ) {
    let asaasCharge: Awaited<ReturnType<AsaasService['createPayment']>>;

    try {
      asaasCharge = await this.asaasService.createPayment(
        gateway.subaccountApiKey,
        {
          customer: gateway.asaasCustomerId,
          billingType: 'BOLETO',
          value: charge.value,
          dueDate: charge.dueDate,
          description: invoice.description || DEFAULT_CHARGE_DESCRIPTION,
          externalReference: invoice.id,
          // Multa e juros são sempre enviados para não herdar a configuração padrão da subconta
          fine: charge.fine,
          interest: charge.interest,
          ...(charge.discount ? { discount: charge.discount } : {}),
        },
      );
    } catch (error: any) {
      this.logger.error(
        `Failed to create Asaas bank slip for invoice ${invoice.id}`,
        error,
      );

      // Sem boleto, a invoice não é mantida
      await this.prisma.invoice.delete({ where: { id: invoice.id } });

      throw new BadRequestException(
        `Falha ao gerar o boleto no Asaas: ${error.message}`,
      );
    }

    try {
      return await this.prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          paymentMethods: {
            ...(invoice.paymentMethods as Prisma.JsonObject),
            BANK_SLIP: {
              gatewayProvider: 'ASAAS',
              gatewayId: asaasCharge.id,
              invoiceUrl: asaasCharge.invoiceUrl,
              bankSlipUrl: asaasCharge.bankSlipUrl ?? null,
              value: charge.value,
              dueDate: charge.dueDate,
              discount: charge.discount,
              fine: charge.fine,
              interest: charge.interest,
            },
          },
          meta: {
            BANK_SLIP: {
              provider: 'ASAAS',
              data: asaasCharge as unknown as Prisma.InputJsonObject,
            },
          },
          gatewayIds: [asaasCharge.id],
        },
      });
    } catch (error) {
      // O boleto existe no Asaas com externalReference = invoice.id (conciliável)
      this.logger.error(
        `Bank slip ${asaasCharge.id} created but invoice ${invoice.id} was not updated`,
        error,
      );
      throw error;
    }
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
