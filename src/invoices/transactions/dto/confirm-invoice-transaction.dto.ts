import { PickType } from '@nestjs/mapped-types';
import { CreateInvoiceTransactionDto } from './create-invoice-transaction.dto.js';

/**
 * Conferência do comprovante enviado pelo pagador: quanto entrou e quando (a data vale para o
 * desconto e a multa), com as mesmas regras do lançamento.
 */
export class ConfirmInvoiceTransactionDto extends PickType(
  CreateInvoiceTransactionDto,
  [
    'amount',
    'occurredAt',
    'bankReference',
    'notes',
    'acknowledgeDuplicates',
  ] as const,
) {}
