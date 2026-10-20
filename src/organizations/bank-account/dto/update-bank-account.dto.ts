import { Transform } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  ValidateIf,
} from 'class-validator';
import { IsCpfCnpj } from '../../../common/decorators/is-cpf-cnpj.decorator.js';
import { IsPixKeyOfType } from '../../../common/decorators/is-pix-key-of-type.decorator.js';
import {
  accountToNull,
  pixKeyToNull,
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

/**
 * Aba "Dados bancários": a conta para transferência e a chave Pix que o pagador vê no checkout.
 * Mesmas regras da conta do fornecedor; o que cada liberação exige é conferido no service. As
 * liberações (transferência e PIX manual) não vêm aqui: só o admin do Fature as muda.
 */
export class UpdateBankAccountDto {
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
  @IsString({ message: 'O nome do titular deve ser um texto' })
  holderName?: string | null;

  /** CPF/CNPJ do titular. */
  @Transform(unmaskToNull)
  @IsOptional()
  @IsCpfCnpj({ message: 'CPF/CNPJ do titular inválido' })
  holderDocument?: string | null;

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
}
