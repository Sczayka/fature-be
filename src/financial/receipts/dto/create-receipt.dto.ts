import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { trim, trimToNull } from '../../../common/dto/transforms.js';
import {
  ENTRY_DESCRIPTION_MAX_LENGTH,
  ENTRY_DOCUMENT_MAX_LENGTH,
  type EntryPaymentMethod,
} from '../../financial.constants.js';
import {
  IsDay,
  IsEntryPaymentMethod,
  IsFinancialAmount,
  IsFinancialNotes,
} from '../../dto/financial-validators.js';

/** Dinheiro recebido fora das faturas (ex.: em espécie): entra já recebido, na conta escolhida. */
export class CreateReceiptDto {
  @Transform(trim)
  @IsString({ message: 'Informe a descrição' })
  @IsNotEmpty({ message: 'Informe a descrição' })
  @MaxLength(ENTRY_DESCRIPTION_MAX_LENGTH, {
    message: `A descrição deve ter no máximo ${ENTRY_DESCRIPTION_MAX_LENGTH} caracteres`,
  })
  description: string;

  @IsFinancialAmount()
  amount: number;

  /** Dia em que o dinheiro entrou, até hoje. */
  @IsDay('a data do recebimento')
  paymentDate: string;

  @IsString({ message: 'Escolha a conta em que o dinheiro entrou' })
  @IsNotEmpty({ message: 'Escolha a conta em que o dinheiro entrou' })
  accountId: string;

  /** Categoria de receita. */
  @Transform(trimToNull)
  @IsOptional()
  @IsString({ message: 'Categoria inválida' })
  categoryId?: string | null;

  /** Cliente que pagou, quando há. */
  @Transform(trimToNull)
  @IsOptional()
  @IsString({ message: 'Cliente inválido' })
  clientId?: string | null;

  @Transform(trimToNull)
  @IsOptional()
  @IsEntryPaymentMethod()
  paymentMethod?: EntryPaymentMethod | null;

  /** Recibo ou nota. */
  @Transform(trimToNull)
  @IsOptional()
  @IsString({ message: 'O número do documento deve ser um texto' })
  @MaxLength(ENTRY_DOCUMENT_MAX_LENGTH, {
    message: `O número do documento deve ter no máximo ${ENTRY_DOCUMENT_MAX_LENGTH} caracteres`,
  })
  documentNumber?: string | null;

  @Transform(trimToNull)
  @IsOptional()
  @IsFinancialNotes()
  notes?: string | null;
}
