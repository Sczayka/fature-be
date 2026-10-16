import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { INVOICE_STATUS } from '../invoices/invoices.constants.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ChargesService } from './charges.service.js';
import { CHARGE_STATUS } from './payments.constants.js';
import type { PaymentEvent } from './providers/payment-provider.js';

/**
 * Eventos dos provedores, já autenticados e normalizados pelo adaptador. O mesmo evento pode
 * chegar mais de uma vez: cada um é aplicado uma única vez (PaymentGatewayEvent.processedAt).
 * Uma falha devolve erro ao provedor, que reenvia o evento.
 */
@Injectable()
export class PaymentEventsService {
  private readonly logger = new Logger(PaymentEventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly charges: ChargesService,
  ) {}

  async handle(provider: string, events: PaymentEvent[]): Promise<void> {
    for (const event of events) {
      const stored = await this.prisma.paymentGatewayEvent.upsert({
        where: {
          provider_externalEventId: {
            provider,
            externalEventId: event.externalEventId,
          },
        },
        create: {
          provider,
          externalEventId: event.externalEventId,
          type: event.providerType,
          payload: event.raw as Prisma.InputJsonObject,
        },
        update: {},
      });

      if (stored.processedAt) continue;

      await this.apply(provider, event);

      await this.prisma.paymentGatewayEvent.update({
        where: { id: stored.id },
        data: { processedAt: new Date() },
      });
    }
  }

  private async apply(provider: string, event: PaymentEvent): Promise<void> {
    if (event.type === 'IGNORED' || !event.chargeExternalId) return;

    const charge = await this.prisma.invoiceCharge.findFirst({
      where: {
        externalId: event.chargeExternalId,
        paymentGatewayAccount: { provider },
      },
    });

    if (!charge) {
      this.logger.warn(
        `Evento ${event.providerType} (${event.externalEventId}) de cobrança fora do Fature: ${provider} ${event.chargeExternalId}`,
      );
      return;
    }

    await this.charges.withInvoiceLock(charge.invoiceId, async (tx) => {
      switch (event.type) {
        case 'CHARGE_PAID':
          await this.charges.markPaid(tx, charge.id, {
            paidAt: event.paidAt ? new Date(event.paidAt) : new Date(),
            paidValue: event.paidValue ?? charge.value,
          });
          return;

        case 'CHARGE_OVERDUE':
          await tx.invoice.updateMany({
            where: { id: charge.invoiceId, status: INVOICE_STATUS.PENDING },
            data: { status: INVOICE_STATUS.OVERDUE },
          });
          return;

        case 'CHARGE_CANCELLED':
          await tx.invoiceCharge.updateMany({
            where: { id: charge.id, status: CHARGE_STATUS.PENDING },
            data: { status: CHARGE_STATUS.CANCELLED },
          });
          return;

        default:
          // Estorno, chargeback e captura recusada: tratamento manual nesta versão
          this.logger.error(
            `Evento ${event.providerType} na cobrança ${charge.id} da fatura ${charge.invoiceId}: verificar manualmente`,
          );
      }
    });
  }
}
