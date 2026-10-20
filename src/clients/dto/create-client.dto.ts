import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';
import { IsCpfCnpj } from '../../common/decorators/is-cpf-cnpj.decorator.js';
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

/**
 * Cliente (pagador) da organização. Vazio vira null; documento, telefones e CEP vão só com os
 * dígitos. O que não está no cadastro (organização, metadados do provedor) é descartado.
 */
export class CreateClientDto {
  /** Razão social ou nome da pessoa. */
  @Transform(trim)
  @IsString({ message: 'Informe o nome do cliente' })
  @IsNotEmpty({ message: 'Informe o nome do cliente' })
  name: string;

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
}
