import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsOptional,
  IsString,
  IsNumber,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class UpdateCompanyInfoDto {
  /** Reply-To dos e-mails aos pagadores; vazio remove. */
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() || null : value,
  )
  @ValidateIf((_dto, value) => value !== null && value !== undefined)
  @IsEmail({}, { message: 'E-mail de contato inválido' })
  @MaxLength(254, { message: 'E-mail de contato inválido' })
  contactEmail?: string | null;

  @IsString()
  @IsOptional()
  cnpj?: string;

  @IsString()
  @IsOptional()
  companyType?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  mobilePhone?: string;

  @IsNumber()
  @IsOptional()
  incomeValue?: number;

  @IsString()
  @IsOptional()
  address?: string;

  @IsString()
  @IsOptional()
  addressNumber?: string;

  @IsString()
  @IsOptional()
  complement?: string;

  @IsString()
  @IsOptional()
  province?: string;

  @IsString()
  @IsOptional()
  postalCode?: string;
}
