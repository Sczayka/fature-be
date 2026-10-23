import { Transform } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { trim, trimToNull } from '../../../common/dto/transforms.js';
import {
  ENTRY_DESCRIPTION_MAX_LENGTH,
  ENTRY_DOCUMENT_MAX_LENGTH,
  PAYROLL_TYPES,
  type EntryPaymentMethod,
  type PayrollType,
} from '../../financial.constants.js';
import {
  IsCompetence,
  IsEntryPaymentMethod,
  IsFinancialNotes,
} from '../../dto/financial-validators.js';

/** Campos da folha: valem com o funcionário (ou quando enviados, para a validação recusar). */
const isPayroll =
  (field: 'payrollType' | 'competence') => (dto: PayableFieldsDto) =>
    dto.employeeId != null || dto[field] != null;

/**
 * Cadastro da conta a pagar, igual na criação e na edição: a quem pagar (fornecedor ou
 * funcionário da folha, nunca os dois), a categoria e o que vem marcado no pagamento.
 */
export class PayableFieldsDto {
  @Transform(trim)
  @IsString({ message: 'Informe a descrição' })
  @IsNotEmpty({ message: 'Informe a descrição' })
  @MaxLength(ENTRY_DESCRIPTION_MAX_LENGTH, {
    message: `A descrição deve ter no máximo ${ENTRY_DESCRIPTION_MAX_LENGTH} caracteres`,
  })
  description: string;

  @Transform(trimToNull)
  @IsOptional()
  @IsString({ message: 'Fornecedor inválido' })
  supplierId?: string | null;

  /** Conta do fornecedor para pagar; o id se mantém nas edições do fornecedor. */
  @Transform(trimToNull)
  @IsOptional()
  @IsString({ message: 'Conta bancária do fornecedor inválida' })
  supplierBankAccountId?: string | null;

  /** Pagamento da folha. */
  @Transform(trimToNull)
  @IsOptional()
  @IsString({ message: 'Funcionário inválido' })
  employeeId?: string | null;

  /** Obrigatório com o funcionário. */
  @Transform(trimToNull)
  @ValidateIf(isPayroll('payrollType'))
  @IsIn(PAYROLL_TYPES, {
    message:
      'Informe o tipo do pagamento da folha: SALARY, ADVANCE, THIRTEENTH, VACATION, BONUS ou OTHER',
  })
  payrollType?: PayrollType | null;

  /** Mês de referência da folha (YYYY-MM); obrigatório com o funcionário. */
  @Transform(trimToNull)
  @ValidateIf(isPayroll('competence'))
  @IsCompetence()
  competence?: string | null;

  /** Categoria de despesa. */
  @Transform(trimToNull)
  @IsOptional()
  @IsString({ message: 'Categoria inválida' })
  categoryId?: string | null;

  /** Nota fiscal, boleto ou recibo. */
  @Transform(trimToNull)
  @IsOptional()
  @IsString({ message: 'O número do documento deve ser um texto' })
  @MaxLength(ENTRY_DOCUMENT_MAX_LENGTH, {
    message: `O número do documento deve ter no máximo ${ENTRY_DOCUMENT_MAX_LENGTH} caracteres`,
  })
  documentNumber?: string | null;

  /** Forma prevista; no pagamento, a usada. */
  @Transform(trimToNull)
  @IsOptional()
  @IsEntryPaymentMethod()
  paymentMethod?: EntryPaymentMethod | null;

  /** Conta prevista; na conta paga, a de onde saiu o dinheiro. */
  @Transform(trimToNull)
  @IsOptional()
  @IsString({ message: 'Conta inválida' })
  accountId?: string | null;

  @Transform(trimToNull)
  @IsOptional()
  @IsFinancialNotes()
  notes?: string | null;
}
