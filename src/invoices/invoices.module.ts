import { Module } from '@nestjs/common';
import { InvoicesController } from './invoices.controller.js';
import { InvoicesService } from './invoices.service.js';
import { InvoiceDraftsController } from './drafts/invoice-drafts.controller.js';
import { InvoiceDraftsService } from './drafts/invoice-drafts.service.js';
import { InvoiceTransactionActionsService } from './transactions/invoice-transaction-actions.service.js';
import { InvoiceTransactionsController } from './transactions/invoice-transactions.controller.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { StockModule } from '../stock/stock.module.js';
import { StorageModule } from '../storage/storage.module.js';

@Module({
  imports: [PaymentsModule, StockModule, StorageModule],
  // Drafts antes de invoices: /invoices/drafts não pode ser capturado por uma rota /invoices/:id
  controllers: [
    InvoiceDraftsController,
    InvoicesController,
    InvoiceTransactionsController,
  ],
  providers: [
    InvoicesService,
    InvoiceDraftsService,
    InvoiceTransactionActionsService,
  ],
})
export class InvoicesModule {}
