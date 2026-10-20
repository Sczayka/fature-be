import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Redirect,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  UsePipes,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ActiveOrgId, CurrentUser } from '../../auth/decorators.js';
import { OrganizationGuard } from '../../auth/organization.guard.js';
import { PayloadValidationPipe } from '../../common/pipes/payload-validation.pipe.js';
import {
  PROOF_MAX_BYTES,
  type UploadedProof,
  proofFilePipe,
} from '../../storage/proof-file.js';
import { CancelInvoiceTransactionDto } from './dto/cancel-invoice-transaction.dto.js';
import { ConfirmInvoiceTransactionDto } from './dto/confirm-invoice-transaction.dto.js';
import { CreateInvoiceTransactionDto } from './dto/create-invoice-transaction.dto.js';
import { RejectInvoiceTransactionDto } from './dto/reject-invoice-transaction.dto.js';
import { InvoiceTransactionActionsService } from './invoice-transaction-actions.service.js';

/** Card "Movimentações" no detalhe da fatura: pagamentos, devoluções e conferência de comprovantes. */
@UseGuards(OrganizationGuard)
@UsePipes(PayloadValidationPipe)
@Controller('invoices/:invoiceId/transactions')
export class InvoiceTransactionsController {
  constructor(private readonly actions: InvoiceTransactionActionsService) {}

  /** multipart/form-data com os dados da transação e o comprovante no campo `file`. */
  @Post()
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: PROOF_MAX_BYTES } }),
  )
  create(
    @ActiveOrgId() orgId: string,
    @Param('invoiceId') invoiceId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateInvoiceTransactionDto,
    @UploadedFile(proofFilePipe) file: UploadedProof,
  ) {
    return this.actions.createByOperator(orgId, invoiceId, userId, dto, file);
  }

  /** Comprovante do pagador conferido no extrato: o valor e a data em que o dinheiro entrou. */
  @Post(':transactionId/confirm')
  confirm(
    @ActiveOrgId() orgId: string,
    @Param('invoiceId') invoiceId: string,
    @Param('transactionId') transactionId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: ConfirmInvoiceTransactionDto,
  ) {
    return this.actions.confirm(orgId, invoiceId, transactionId, userId, dto);
  }

  @Post(':transactionId/reject')
  reject(
    @ActiveOrgId() orgId: string,
    @Param('invoiceId') invoiceId: string,
    @Param('transactionId') transactionId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: RejectInvoiceTransactionDto,
  ) {
    return this.actions.reject(
      orgId,
      invoiceId,
      transactionId,
      userId,
      dto.reason,
    );
  }

  @Post(':transactionId/cancel')
  cancel(
    @ActiveOrgId() orgId: string,
    @Param('invoiceId') invoiceId: string,
    @Param('transactionId') transactionId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CancelInvoiceTransactionDto,
  ) {
    return this.actions.cancel(
      orgId,
      invoiceId,
      transactionId,
      userId,
      dto.reason,
    );
  }

  /** Abre o comprovante: redireciona para a URL assinada, que expira em poucos minutos. */
  @Get(':transactionId/proof')
  @Redirect()
  async proof(
    @ActiveOrgId() orgId: string,
    @Param('invoiceId') invoiceId: string,
    @Param('transactionId') transactionId: string,
  ) {
    const url = await this.actions.proofUrl(orgId, invoiceId, transactionId);

    return { url, statusCode: 302 };
  }
}
