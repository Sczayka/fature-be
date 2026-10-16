import { Type } from 'class-transformer';
import {
  IsDefined,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import type { CardCaptureMode } from '../../payments/providers/payment-provider.js';

/** Dados do cartão (modo RAW): nunca gravados nem logados. */
export class RawCardDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  holderName: string;

  @Matches(/^\d{13,19}$/, { message: 'Número do cartão inválido' })
  number: string;

  @Matches(/^(0[1-9]|1[0-2])$/, { message: 'Mês de validade inválido' })
  expiryMonth: string;

  @Matches(/^\d{4}$/, { message: 'Ano de validade inválido' })
  expiryYear: string;

  @Matches(/^\d{3,4}$/, { message: 'Código de segurança inválido' })
  ccv: string;
}

/** Titular do cartão: o provedor compara com os dados do emissor (antifraude). */
export class CardHolderDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsEmail({}, { message: 'E-mail do titular inválido' })
  email: string;

  @Matches(/^(\d{11}|\d{14})$/, { message: 'CPF/CNPJ do titular inválido' })
  cpfCnpj: string;

  @Matches(/^\d{8}$/, { message: 'CEP do titular inválido' })
  postalCode: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  addressNumber: string;

  @Matches(/^\d{10,11}$/, { message: 'Telefone do titular inválido' })
  phone: string;
}

export class PayWithCreditCardDto {
  @IsIn(['RAW', 'PROVIDER_TOKEN'])
  mode: CardCaptureMode;

  @ValidateIf((dto: PayWithCreditCardDto) => dto.mode === 'RAW')
  @IsDefined()
  @ValidateNested()
  @Type(() => RawCardDto)
  card?: RawCardDto;

  @ValidateIf((dto: PayWithCreditCardDto) => dto.mode === 'PROVIDER_TOKEN')
  @IsString()
  @IsNotEmpty()
  token?: string;

  @IsDefined()
  @ValidateNested()
  @Type(() => CardHolderDto)
  holder: CardHolderDto;
}
