import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { trimToNull } from '../../../common/dto/transforms.js';
import { ENTRY_DESCRIPTION_MAX_LENGTH } from '../../financial.constants.js';
import {
  IsDay,
  IsFinancialAmount,
  IsFinancialNotes,
} from '../../dto/financial-validators.js';

/** Dinheiro que passou de uma conta para outra (ex.: saque da conta do Fature para o banco). */
export class CreateTransferDto {
  @IsString({ message: 'Escolha a conta de origem' })
  @IsNotEmpty({ message: 'Escolha a conta de origem' })
  fromAccountId: string;

  @IsString({ message: 'Escolha a conta de destino' })
  @IsNotEmpty({ message: 'Escolha a conta de destino' })
  toAccountId: string;

  @IsFinancialAmount()
  amount: number;

  /** Até hoje. */
  @IsDay('a data da transferência')
  date: string;

  /** Ausente: "Transferência para {destino}" na saída e "Transferência de {origem}" na entrada. */
  @Transform(trimToNull)
  @IsOptional()
  @IsString({ message: 'A descrição deve ser um texto' })
  @MaxLength(ENTRY_DESCRIPTION_MAX_LENGTH, {
    message: `A descrição deve ter no máximo ${ENTRY_DESCRIPTION_MAX_LENGTH} caracteres`,
  })
  description?: string | null;

  @Transform(trimToNull)
  @IsOptional()
  @IsFinancialNotes()
  notes?: string | null;
}
