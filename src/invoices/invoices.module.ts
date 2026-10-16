import { Module } from '@nestjs/common';
import { InvoicesController } from './invoices.controller.js';
import { InvoicesService } from './invoices.service.js';
import { InvoiceDraftsController } from './drafts/invoice-drafts.controller.js';
import { InvoiceDraftsService } from './drafts/invoice-drafts.service.js';
import { PaymentsModule } from '../payments/payments.module.js';

@Module({
  imports: [PaymentsModule],
  // Drafts antes de invoices: /invoices/drafts não pode ser capturado por uma rota /invoices/:id
  controllers: [InvoiceDraftsController, InvoicesController],
  providers: [InvoicesService, InvoiceDraftsService],
})
export class InvoicesModule {}
