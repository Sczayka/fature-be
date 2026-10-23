import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { IsCpfCnpj } from '../../../common/decorators/is-cpf-cnpj.decorator.js';
import { IsOptionalNotNull } from '../../../common/decorators/is-optional-not-null.decorator.js';
import { IsPixKeyOfType } from '../../../common/decorators/is-pix-key-of-type.decorator.js';
import { PHONE_PATTERN } from '../../../common/dto/patterns.js';
import {
  accountToNull,
  emailToNull,
  pixKeyToNull,
  trim,
  trimToNull,
  unmaskToNull,
} from '../../../common/dto/transforms.js';
import {
  hasBankTransferData,
  hasPixData,
} from '../../../suppliers/dto/supplier-bank-account.dto.js';
import {
  ACCOUNT_NUMBER_PATTERN,
  BANK_ACCOUNT_TYPES,
  BANK_CODE_PATTERN,
  BRANCH_PATTERN,
  PIX_KEY_TYPES,
  type BankAccountType,
  type PixKeyType,
} from '../../../suppliers/suppliers.constants.js';
import { FINANCIAL_AMOUNT_MAX } from '../../financial.constants.js';
import { IsDay, IsFinancialNotes } from '../../dto/financial-validators.js';

const SALARY_MESSAGE =
  'Informe o salário: um número de 0 a 999.999.999,99, com até 2 casas decimais';

/**
 * Funcionário, para os pagamentos da folha. Para pagar, a chave Pix e/ou a conta bancária, com
 * as regras da conta do fornecedor. Vazio vira null; CPF e telefone vão só com os dígitos.
 */
export class CreateEmployeeDto {
  @Transform(trim)
  @IsString({ message: 'Informe o nome do funcionário' })
  @IsNotEmpty({ message: 'Informe o nome do funcionário' })
  @MaxLength(120, {
    message: 'O nome do funcionário deve ter no máximo 120 caracteres',
  })
  name: string;

  /** Único na organização quando informado. */
  @Transform(unmaskToNull)
  @IsOptional()
  @Matches(/^\d{11}$/, { message: 'CPF inválido: informe os 11 dígitos' })
  @IsCpfCnpj({ message: 'CPF inválido' })
  cpf?: string | null;

  /** Cargo ou função. */
  @Transform(trimToNull)
  @IsOptional()
  @IsString({ message: 'O cargo deve ser um texto' })
  @MaxLength(80, { message: 'O cargo deve ter no máximo 80 caracteres' })
  role?: string | null;

  @Transform(emailToNull)
  @IsOptional()
  @IsEmail({}, { message: 'E-mail inválido' })
  email?: string | null;

  @Transform(unmaskToNull)
  @IsOptional()
  @Matches(PHONE_PATTERN, {
    message: 'Telefone inválido: informe DDD e número',
  })
  phone?: string | null;

  @Transform(trimToNull)
  @IsOptional()
  @IsDay('a data de admissão')
  admissionDate?: string | null;

  /** Salário mensal: o valor da folha gerada. */
  @IsNumber({ maxDecimalPlaces: 2 }, { message: SALARY_MESSAGE })
  @Min(0, { message: SALARY_MESSAGE })
  @Max(FINANCIAL_AMOUNT_MAX, { message: SALARY_MESSAGE })
  salary: number;

  @Transform(trimToNull)
  @ValidateIf(hasPixData)
  @IsIn(PIX_KEY_TYPES, {
    message: 'Informe o tipo da chave Pix: CPF, CNPJ, EMAIL, PHONE ou EVP',
  })
  pixKeyType?: PixKeyType | null;

  @Transform(pixKeyToNull)
  @ValidateIf(hasPixData)
  @IsPixKeyOfType()
  pixKey?: string | null;

  /** Código COMPE do banco. */
  @Transform(unmaskToNull)
  @ValidateIf(hasBankTransferData)
  @Matches(BANK_CODE_PATTERN, {
    message: 'Informe o código do banco com 3 dígitos (ex.: 001)',
  })
  bankCode?: string | null;

  @Transform(trimToNull)
  @IsOptional()
  @IsString({ message: 'O nome do banco deve ser um texto' })
  bankName?: string | null;

  @Transform(accountToNull)
  @ValidateIf(hasBankTransferData)
  @Matches(BRANCH_PATTERN, {
    message: 'Informe a agência: só números, com o dígito depois do hífen',
  })
  branch?: string | null;

  /** Com o dígito. */
  @Transform(accountToNull)
  @ValidateIf(hasBankTransferData)
  @Matches(ACCOUNT_NUMBER_PATTERN, {
    message:
      'Informe a conta com o dígito: só números, com o dígito depois do hífen',
  })
  accountNumber?: string | null;

  @Transform(trimToNull)
  @ValidateIf(hasBankTransferData)
  @IsIn(BANK_ACCOUNT_TYPES, {
    message:
      'Informe o tipo da conta: corrente (CHECKING) ou poupança (SAVINGS)',
  })
  accountType?: BankAccountType | null;

  @Transform(trimToNull)
  @IsOptional()
  @IsFinancialNotes()
  notes?: string | null;

  /** Ausente no cadastro: ativo. */
  @IsOptionalNotNull()
  @IsBoolean({ message: 'Informe se o funcionário está ativo' })
  active?: boolean;
}
