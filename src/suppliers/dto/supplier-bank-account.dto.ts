import { Transform, type TransformFnParams } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  ValidateBy,
  ValidateIf,
} from 'class-validator';
import { IsCpfCnpj } from '../../common/decorators/is-cpf-cnpj.decorator.js';
import { trimToNull, unmaskToNull } from '../../common/dto/transforms.js';
import { isValidPixKey, normalizePixKey } from '../../common/utils/pix-key.js';
import {
  ACCOUNT_NUMBER_PATTERN,
  BANK_ACCOUNT_TYPES,
  BANK_CODE_PATTERN,
  BRANCH_PATTERN,
  PIX_KEY_TYPES,
  type BankAccountType,
  type PixKeyType,
} from '../suppliers.constants.js';

type PaymentDestination = Pick<
  SupplierBankAccountDto,
  | 'bankCode'
  | 'branch'
  | 'accountNumber'
  | 'accountType'
  | 'pixKeyType'
  | 'pixKey'
>;

/** Algum dado de transferência informado: aí banco, agência, conta e tipo são exigidos juntos. */
export function hasBankTransferData(account: PaymentDestination): boolean {
  return [
    account.bankCode,
    account.branch,
    account.accountNumber,
    account.accountType,
  ].some((value) => value != null);
}

/** Tipo ou chave Pix informados: aí os dois são exigidos. */
export function hasPixData(account: PaymentDestination): boolean {
  return account.pixKeyType != null || account.pixKey != null;
}

const isPixKeyType = (value: unknown): value is PixKeyType =>
  PIX_KEY_TYPES.includes(value as PixKeyType);

/** Agência e conta: sem espaços e pontos, com o dígito X em maiúscula. */
const accountToNull = ({ value }: TransformFnParams) =>
  typeof value === 'string'
    ? value.replace(/[\s.]/g, '').toUpperCase() || null
    : value;

/** Chave no formato do DICT, conforme o tipo enviado junto. */
const pixKeyToNull = ({ value, obj }: TransformFnParams) => {
  if (typeof value !== 'string') return value;

  const key = isPixKeyType(obj.pixKeyType)
    ? normalizePixKey(obj.pixKeyType, value)
    : value.trim();

  return key || null;
};

function IsPixKeyOfType() {
  return ValidateBy({
    name: 'isPixKeyOfType',
    validator: {
      validate: (value, args) => {
        const type = (args?.object as PaymentDestination | undefined)
          ?.pixKeyType;

        return (
          typeof value === 'string' &&
          isPixKeyType(type) &&
          isValidPixKey(type, value)
        );
      },
      defaultMessage: () =>
        'Informe uma chave Pix válida para o tipo escolhido',
    },
  });
}

/**
 * Conta para pagar o fornecedor: dados de transferência (banco, agência, conta e tipo), chave Pix
 * ou os dois. Com id, atualiza a já cadastrada (o id não muda: as contas a pagar apontam para
 * ele); sem id, cria. Dados sensíveis: as mensagens não repetem os valores.
 */
export class SupplierBankAccountDto {
  @IsOptional()
  @IsString({ message: 'Conta bancária inválida' })
  id?: string;

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

  @IsOptional()
  @IsBoolean({ message: 'Informe se é a conta principal' })
  isMain?: boolean;
}
