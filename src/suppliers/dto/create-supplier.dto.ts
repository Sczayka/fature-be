import { Transform, Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  ValidateBy,
  ValidateNested,
} from 'class-validator';
import { IsCpfCnpj } from '../../common/decorators/is-cpf-cnpj.decorator.js';
import { IsOptionalNotNull } from '../../common/decorators/is-optional-not-null.decorator.js';
import {
  CEP_PATTERN,
  PHONE_PATTERN,
  UF_PATTERN,
} from '../../common/dto/patterns.js';
import {
  emailToNull,
  stateToNull,
  trim,
  trimToNull,
  unmaskToNull,
} from '../../common/dto/transforms.js';
import { paymentTermError } from '../../common/utils/payment-term.js';
import { SupplierBankAccountDto } from './supplier-bank-account.dto.js';
import { SupplierContactDto } from './supplier-contact.dto.js';

/** Até 12 parcelas, de 0 a 365 dias, em ordem crescente; a mensagem diz o que está errado. */
function IsPaymentTerm() {
  return ValidateBy({
    name: 'isPaymentTerm',
    validator: {
      validate: (value) => paymentTermError(value) === null,
      defaultMessage: (args) => paymentTermError(args?.value) ?? '',
    },
  });
}

/**
 * Fornecedor no molde do cliente, mais nome fantasia, prazo de pagamento, observações, marcas que
 * fornece, contatos e contas para pagamento. Vazio vira null; documentos e telefones vão só com os
 * dígitos.
 */
export class CreateSupplierDto {
  /** Razão social ou nome da pessoa. */
  @Transform(trim)
  @IsString({ message: 'Informe o nome ou a razão social' })
  @IsNotEmpty({ message: 'Informe o nome ou a razão social' })
  name: string;

  /** Nome fantasia. */
  @Transform(trimToNull)
  @IsOptional()
  @IsString({ message: 'O nome fantasia deve ser um texto' })
  tradeName?: string | null;

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

  @Transform(unmaskToNull)
  @IsOptional()
  @Matches(PHONE_PATTERN, { message: 'Celular inválido: informe DDD e número' })
  mobile?: string | null;

  /** Único na organização quando informado. */
  @Transform(unmaskToNull)
  @IsOptional()
  @IsCpfCnpj()
  cpfCnpj?: string | null;

  @Transform(trimToNull)
  @IsOptional()
  @IsString({ message: 'A inscrição municipal deve ser um texto' })
  municipalInscription?: string | null;

  @Transform(trimToNull)
  @IsOptional()
  @IsString({ message: 'A inscrição estadual deve ser um texto' })
  stateInscription?: string | null;

  @Transform(unmaskToNull)
  @IsOptional()
  @Matches(CEP_PATTERN, { message: 'CEP inválido: informe os 8 dígitos' })
  cep?: string | null;

  @Transform(trimToNull)
  @IsOptional()
  @IsString({ message: 'O logradouro deve ser um texto' })
  addressLine?: string | null;

  @Transform(trimToNull)
  @IsOptional()
  @IsString({ message: 'O número do endereço deve ser um texto' })
  addressNumber?: string | null;

  @Transform(trimToNull)
  @IsOptional()
  @IsString({ message: 'O complemento deve ser um texto' })
  complement?: string | null;

  @Transform(trimToNull)
  @IsOptional()
  @IsString({ message: 'O bairro deve ser um texto' })
  district?: string | null;

  /** UF. */
  @Transform(stateToNull)
  @IsOptional()
  @Matches(UF_PATTERN, {
    message: 'UF inválida: use a sigla do estado (ex.: SP)',
  })
  state?: string | null;

  @Transform(trimToNull)
  @IsOptional()
  @IsString({ message: 'A cidade deve ser um texto' })
  city?: string | null;

  /** Dias de cada parcela, contados da compra: [30, 60, 90]; [] = não informado. */
  @IsOptionalNotNull()
  @IsPaymentTerm()
  paymentTermDays?: number[];

  @Transform(trimToNull)
  @IsOptional()
  @IsString({ message: 'As observações devem ser um texto' })
  notes?: string | null;

  /** Ausente no cadastro: ativo. */
  @IsOptionalNotNull()
  @IsBoolean({ message: 'Informe se o fornecedor está ativo' })
  active?: boolean;

  /** Marcas que fornece; substitui a lista. */
  @IsOptionalNotNull()
  @IsArray({ message: 'Envie as marcas em uma lista' })
  @ArrayUnique({ message: 'A mesma marca aparece mais de uma vez' })
  @IsString({ each: true, message: 'Marca inválida' })
  brandIds?: string[];

  /** Sincronizados pelo id: com id atualiza, sem id cria e o que não vier é apagado. */
  @IsOptionalNotNull()
  @IsArray({ message: 'Envie os contatos em uma lista' })
  @ValidateNested({ each: true })
  @Type(() => SupplierContactDto)
  contacts?: SupplierContactDto[];

  /** Sincronizadas pelo id, como os contatos. */
  @IsOptionalNotNull()
  @IsArray({ message: 'Envie as contas bancárias em uma lista' })
  @ValidateNested({ each: true })
  @Type(() => SupplierBankAccountDto)
  bankAccounts?: SupplierBankAccountDto[];
}
