import { Transform } from 'class-transformer';
import { IsOptional, IsString } from 'class-validator';
import { trimToNull } from '../../../common/dto/transforms.js';
import { IsCompetence, IsDay } from '../../dto/financial-validators.js';

/** POST /financial/payroll/generate: os salários do mês, todos com o mesmo vencimento. */
export class GeneratePayrollDto {
  /** Mês de referência (YYYY-MM). */
  @IsCompetence()
  competence: string;

  @IsDay('o vencimento')
  dueDate: string;

  /** Categoria de despesa dos salários. */
  @Transform(trimToNull)
  @IsOptional()
  @IsString({ message: 'Categoria inválida' })
  categoryId?: string | null;

  /** Conta prevista para pagar. */
  @Transform(trimToNull)
  @IsOptional()
  @IsString({ message: 'Conta inválida' })
  accountId?: string | null;
}
