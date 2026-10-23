import { Module } from '@nestjs/common';
import { InvoiceReceiptsService } from '../financial/receipts/invoice-receipts.service.js';
import { ChargesService } from './charges.service.js';
import { CredentialsCipher } from './credentials/credentials-cipher.js';
import { OrganizationPaymentMethodsService } from './organization-payment-methods.service.js';
import { PaymentCustomersService } from './payment-customers.service.js';
import { PaymentEventsService } from './payment-events.service.js';
import { PaymentRoutingService } from './payment-routing.service.js';
import { PaymentSetupService } from './payment-setup.service.js';
import { AsaasClient } from './providers/asaas/asaas.client.js';
import { AsaasProvider } from './providers/asaas/asaas.provider.js';
import {
  PAYMENT_PROVIDERS,
  PaymentProviderRegistry,
} from './providers/payment-provider.registry.js';
import { InvoiceTransactionsService } from './transactions/invoice-transactions.service.js';
import { WebhooksController } from './webhooks/webhooks.controller.js';

/**
 * Núcleo de pagamentos. Novo provedor: implemente PaymentProvider, adicione o adaptador
 * em PAYMENT_PROVIDERS e as capacidades em PROVIDER_CAPABILITIES. Os recebimentos do financeiro
 * (InvoiceReceiptsService) ficam aqui porque acompanham as movimentações das faturas.
 */
@Module({
  controllers: [WebhooksController],
  providers: [
    CredentialsCipher,
    AsaasClient,
    AsaasProvider,
    {
      provide: PAYMENT_PROVIDERS,
      useFactory: (asaas: AsaasProvider) => [asaas],
      inject: [AsaasProvider],
    },
    PaymentProviderRegistry,
    PaymentRoutingService,
    OrganizationPaymentMethodsService,
    PaymentCustomersService,
    PaymentSetupService,
    InvoiceReceiptsService,
    InvoiceTransactionsService,
    ChargesService,
    PaymentEventsService,
  ],
  exports: [
    PaymentProviderRegistry,
    PaymentRoutingService,
    OrganizationPaymentMethodsService,
    PaymentCustomersService,
    PaymentSetupService,
    InvoiceReceiptsService,
    InvoiceTransactionsService,
    ChargesService,
  ],
})
export class PaymentsModule {}
