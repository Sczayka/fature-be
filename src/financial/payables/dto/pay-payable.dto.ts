import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { trimToNull } from '../../../common/dto/transforms.js';
import type { EntryPaymentMethod } from '../../financial.constants.js';
import {
  IsDay,
  IsEntryPaymentMethod,
  IsFinancialAmount,
} from '../../dto/financial-validators.js';

/** Baixa da conta a pagar: quando, de qual conta e quanto saiu (com juros ou desconto). */
export class PayPayableDto {
  /** Até hoje. */
  @IsDay('a data do pagamento')
  paymentDate: string;

  @IsString({ message: 'Escolha a conta de onde saiu o dinheiro' })
  @IsNotEmpty({ message: 'Escolha a conta de onde saiu o dinheiro' })
  accountId: string;

  @IsFinancialAmount('O valor pago')
  paidAmount: number;

  /** Ausente: a forma prevista na conta. */
  @Transform(trimToNull)
  @IsOptional()
  @IsEntryPaymentMethod()
  paymentMethod?: EntryPaymentMethod | null;
}
