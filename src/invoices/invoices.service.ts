import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AsaasService } from '../asaas/asaas.service.js';
import { CreateInvoiceDto } from './dto/create-invoice.dto.js';

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    private prisma: PrismaService,
    private asaasService: AsaasService,
  ) {}

  async create(organizationId: string, createInvoiceDto: CreateInvoiceDto) {
    // 1. Get Client and Organization
    const client = await this.prisma.client.findUnique({
      where: { id: createInvoiceDto.clientId },
    });

    if (!client) {
      throw new NotFoundException('Client not found');
    }

    if (client.organizationId !== organizationId) {
      throw new BadRequestException(
        'Client does not belong to this organization',
      );
    }

    // 2. Extract Asaas Customer ID
    const asaasCustomerId = (client.metadata as any)?.asaas?.id;
    if (!asaasCustomerId) {
      throw new BadRequestException(
        'Client must be synced with Asaas (missing asaasId)',
      );
    }

    // 3. Get Gateway Account for this Organization
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
        'Asaas Gateway Account not configured for this organization',
      );
    }

    // 4. Decrypt API Key
    const encryptedApiKey = (gatewayAccount.metadata as any).apiKey;
    if (!encryptedApiKey) {
      throw new BadRequestException('Asaas Gateway Account is missing API Key');
    }
    const subaccountApiKey = this.asaasService.decryptApiKey(encryptedApiKey);

    // 5. Build Asaas Payload
    // For now, if paymentMethods defines bankSlip, we create a Boleto charge.
    // If it defines multiple, we could use UNDEFINED or create separate charges.
    // As per user spec, we map paymentMethods to separate charges.

    const createdGateways: any = {};
    const createdMeta: any = {};
    const gatewayIds: string[] = [];

    // Let's iterate over requested payment methods
    for (const [methodKey, methodConfig] of Object.entries(
      createInvoiceDto.paymentMethods,
    )) {
      // Map methodKey to Asaas billingType
      let billingType = 'UNDEFINED';
      if (methodKey === 'bankSlip' || methodKey === 'BOLETO')
        billingType = 'BOLETO';
      if (methodKey === 'creditCard' || methodKey === 'CREDIT_CARD')
        billingType = 'CREDIT_CARD';
      if (methodKey === 'pix' || methodKey === 'PIX') billingType = 'PIX';

      const asaasPayload = {
        customer: asaasCustomerId,
        billingType,
        value: createInvoiceDto.totalValue,
        dueDate: createInvoiceDto.dueDate,
        description: 'Fatura gerada via Fature',
      };

      try {
        const asaasCharge = await this.asaasService.createPayment(
          subaccountApiKey,
          asaasPayload,
        );

        createdGateways[methodKey] = {
          gatewayId: asaasCharge.id,
          gatewayProvider: 'ASAAS',
          invoiceUrl: asaasCharge.invoiceUrl,
        };

        createdMeta[methodKey] = {
          provider: 'ASAAS',
          data: asaasCharge,
        };

        gatewayIds.push(asaasCharge.id);
      } catch (error: any) {
        this.logger.error(
          `Failed to create Asaas charge for ${methodKey}`,
          error,
        );
        throw new BadRequestException(
          `Failed to create Asaas charge: ${error.message}`,
        );
      }
    }

    // 6. Save Invoice to DB
    const invoice = await this.prisma.invoice.create({
      data: {
        organizationId,
        clientId: createInvoiceDto.clientId,
        items: createInvoiceDto.items,
        totalValue: createInvoiceDto.totalValue,
        dueDate: new Date(createInvoiceDto.dueDate),
        status: 'PENDING',
        paymentMethods: createdGateways,
        meta: createdMeta,
        gatewayIds,
      },
    });

    return invoice;
  }
}
