import { IsOptional, IsString, IsNumber } from 'class-validator';

export class UpdateCompanyInfoDto {
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
