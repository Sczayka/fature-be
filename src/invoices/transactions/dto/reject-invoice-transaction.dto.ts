import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';
import { trim } from '../../../common/dto/transforms.js';

export class RejectInvoiceTransactionDto {
  /** Aparece para o pagador no checkout e no e-mail de recusa. */
  @Transform(trim)
  @IsString({ message: 'Informe o motivo da recusa' })
  @Length(3, 300, { message: 'O motivo deve ter de 3 a 300 caracteres' })
  reason: string;
}
