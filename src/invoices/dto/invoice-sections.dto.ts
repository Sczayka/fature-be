import { applyDecorators } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDefined,
  IsEmail,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateBy,
  ValidateIf,
  ValidateNested,
  buildMessage,
} from 'class-validator';
import {
  AMOUNT_TYPES,
  DESCRIPTION_MAX_LENGTH,
  ITEM_TYPES,
  PAYMENT_METHODS,
  PROMOTION_APPLICATIONS,
} from '../invoices.constants.js';
import type {
  AmountType,
  ItemType,
  PaymentMethod,
  PromotionApplication,
} from '../invoices.constants.js';

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Data sem horário no formato YYYY-MM-DD. */
export function IsDateOnly() {
  return applyDecorators(
    IsString(),
    Matches(DATE_ONLY_PATTERN, {
      message: '$property deve estar no formato YYYY-MM-DD',
    }),
    IsISO8601(
      { strict: true },
      { message: '$property deve ser uma data válida' },
    ),
  );
}

/** Data YYYY-MM-DD opcional: aceita ausência, null ou string vazia. */
export function IsOptionalDateOnly() {
  return applyDecorators(
    ValidateIf(
      (_, value) => value !== undefined && value !== null && value !== '',
    ),
    IsDateOnly(),
  );
}

/** Limita o valor a 100 quando a propriedade de tipo indicada for PERCENTAGE. */
export function IsPercentWithinLimit(typeProperty: string) {
  return ValidateBy({
    name: 'isPercentWithinLimit',
    constraints: [typeProperty],
    validator: {
      validate: (value, args) => {
        const object = args?.object as Record<string, unknown> | undefined;

        return (
          object?.[typeProperty] !== 'PERCENTAGE' ||
          (typeof value === 'number' && value <= 100)
        );
      },
      defaultMessage: buildMessage(
        (eachPrefix) => `${eachPrefix}$property não pode ser maior que 100%`,
      ),
    },
  });
}

export class InvoiceClientDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  @ValidateIf((_, value) => value !== '')
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  mobile?: string;

  @IsOptional()
  @IsString()
  cpfCnpj?: string;

  @IsOptional()
  @IsString()
  municipalInscription?: string;

  @IsOptional()
  @IsString()
  stateInscription?: string;

  @IsOptional()
  @IsString()
  cep?: string;

  @IsOptional()
  @IsString()
  addressLine?: string;

  @IsOptional()
  @IsString()
  addressNumber?: string;

  @IsOptional()
  @IsString()
  complement?: string;

  @IsOptional()
  @IsString()
  district?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  city?: string;
}

export class InvoiceItemDto {
  @IsString()
  @IsNotEmpty()
  id: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsIn(ITEM_TYPES)
  type: ItemType;

  @IsNumber()
  @IsPositive()
  price: number;
}

export class InvoiceItemLineDto {
  @IsDefined()
  @ValidateNested()
  @Type(() => InvoiceItemDto)
  item: InvoiceItemDto;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsNumber()
  @Min(0)
  total: number;
}

class BillingDetailsDto {
  @IsOptionalDateOnly()
  referenceDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(DESCRIPTION_MAX_LENGTH)
  description?: string;
}

/** Dados de cobrança para emissão: o vencimento é obrigatório. */
export class InvoiceBillingDto extends BillingDetailsDto {
  @IsDateOnly()
  dueDate: string;
}

/** Dados de cobrança de um orçamento: o vencimento pode ficar em branco. */
export class DraftBillingDto extends BillingDetailsDto {
  @IsOptionalDateOnly()
  dueDate?: string;
}

class DiscountConfigDto {
  @IsIn(AMOUNT_TYPES)
  type: AmountType;

  @IsNumber()
  @Min(0)
  @IsPercentWithinLimit('type')
  value: number;
}

/**
 * Promoção aplicada ao item: cópia das regras dela. Na emissão, é conferida com o cadastro
 * (src/invoices/pricing/invoice-rules.ts) e gravada com o nome atual.
 */
export class ItemDiscountPromotionDto {
  @IsString()
  @IsNotEmpty()
  id: string;

  @IsString()
  name: string;

  @IsIn(PROMOTION_APPLICATIONS)
  application: PromotionApplication;

  /** Teto do desconto na linha, em R$; null = sem teto. */
  @ValidateIf((_, value) => value !== null)
  @IsNumber()
  @IsPositive()
  maxAmount: number | null = null;

  /** Unidades da linha que a promoção atinge; null = todas. */
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(1)
  maxQuantity: number | null = null;
}

/** Desconto por item: abate o preço do item, sem prazo. */
export class ItemDiscountDto extends DiscountConfigDto {
  @IsString()
  @IsNotEmpty()
  id: string;

  /** Ausente ou null: desconto digitado. */
  @IsOptional()
  @ValidateNested()
  @Type(() => ItemDiscountPromotionDto)
  promotion: ItemDiscountPromotionDto | null = null;
}

export class MethodDiscountDto extends DiscountConfigDto {
  @IsIn(PAYMENT_METHODS)
  method: PaymentMethod;

  /** Vazio = válido até o vencimento. */
  @IsOptionalDateOnly()
  limitDate: string = '';
}

export class InvoiceDiscountDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ItemDiscountDto)
  items: ItemDiscountDto[] = [];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MethodDiscountDto)
  methods: MethodDiscountDto[] = [];
}

export class InterestAndFineDto {
  @IsIn(AMOUNT_TYPES)
  fineType: AmountType = 'PERCENTAGE';

  @IsNumber()
  @Min(0)
  @IsPercentWithinLimit('fineType')
  fineValue: number = 0;

  @IsIn(AMOUNT_TYPES)
  interestType: AmountType = 'PERCENTAGE';

  @IsNumber()
  @Min(0)
  @IsPercentWithinLimit('interestType')
  interestValue: number = 0;
}
