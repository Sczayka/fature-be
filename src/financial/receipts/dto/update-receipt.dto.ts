import { PartialType } from '@nestjs/mapped-types';
import { CreateReceiptDto } from './create-receipt.dto.js';

/**
 * Campo ausente não muda nada; null limpa os opcionais. Nos recebimentos das faturas, só a conta,
 * a categoria e a observação mudam: o resto segue a movimentação da fatura.
 */
export class UpdateReceiptDto extends PartialType(CreateReceiptDto, {
  skipNullProperties: false,
}) {}
