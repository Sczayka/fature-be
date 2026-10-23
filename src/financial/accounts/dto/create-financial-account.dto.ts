import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { IsOptionalNotNull } from '../../../common/decorators/is-optional-not-null.decorator.js';
import { trim, trimToNull } from '../../../common/dto/transforms.js';
import {
  FINANCIAL_ACCOUNT_NAME_MAX_LENGTH,
  FINANCIAL_ACCOUNT_TYPES,
  FINANCIAL_AMOUNT_MAX,
  type FinancialAccountType,
} from '../../financial.constants.js';
import { IsDay, IsFinancialNotes } from '../../dto/financial-validators.js';

const OPENING_BALANCE_MESSAGE =
  'O saldo inicial deve ser um número com até 2 casas decimais, de -999.999.999,99 a 999.999.999,99';

/** Conta do caixa: banco, provedor de pagamento (ex.: maquininha) ou dinheiro. */
export class CreateFinancialAccountDto {
  @Transform(trim)
  @IsString({ message: 'Informe o nome da conta' })
  @IsNotEmpty({ message: 'Informe o nome da conta' })
  @MaxLength(FINANCIAL_ACCOUNT_NAME_MAX_LENGTH, {
    message: `O nome da conta deve ter no máximo ${FINANCIAL_ACCOUNT_NAME_MAX_LENGTH} caracteres`,
  })
  name: string;

  @IsIn(FINANCIAL_ACCOUNT_TYPES, {
    message:
      'Tipo inválido: use BANK (banco), PAYMENT_PROVIDER (provedor de pagamento) ou CASH (dinheiro)',
  })
  type: FinancialAccountType;

  /** Saldo no começo do dia `openingDate`; negativo no cheque especial. Ausente: zero. */
  @IsOptionalNotNull()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: OPENING_BALANCE_MESSAGE })
  @Min(-FINANCIAL_AMOUNT_MAX, { message: OPENING_BALANCE_MESSAGE })
  @Max(FINANCIAL_AMOUNT_MAX, { message: OPENING_BALANCE_MESSAGE })
  openingBalance?: number;

  /** Dia do saldo inicial, até hoje; ausente: hoje. O que foi pago antes não entra no saldo. */
  @IsOptionalNotNull()
  @IsDay('o dia do saldo inicial')
  openingDate?: string;

  /** Principal: recebe os pagamentos manuais das faturas. Marcar uma desmarca a anterior. */
  @IsOptionalNotNull()
  @IsBoolean({ message: 'Informe se é a conta principal' })
  isMain?: boolean;

  /** Ausente no cadastro: ativa. */
  @IsOptionalNotNull()
  @IsBoolean({ message: 'Informe se a conta está ativa' })
  active?: boolean;

  @Transform(trimToNull)
  @IsOptional()
  @IsFinancialNotes()
  notes?: string | null;
}
