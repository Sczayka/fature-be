import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';
import { trim } from '../../../common/dto/transforms.js';

export class CancelInvoiceTransactionDto {
  /** Fica na transação cancelada, no histórico da fatura. */
  @Transform(trim)
  @IsString({ message: 'Informe o motivo do cancelamento' })
  @Length(3, 300, { message: 'O motivo deve ter de 3 a 300 caracteres' })
  reason: string;
}
