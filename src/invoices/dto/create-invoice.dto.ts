import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDefined,
  IsIn,
  IsOptional,
  ValidateNested,
} from 'class-validator';
import { PAYMENT_METHODS } from '../invoices.constants.js';
import type { PaymentMethod } from '../invoices.constants.js';
import {
  InterestAndFineDto,
  InvoiceBillingDto,
  InvoiceClientDto,
  InvoiceDiscountDto,
  InvoiceItemLineDto,
} from './invoice-sections.dto.js';

export class CreateInvoiceDto {
  @IsDefined()
  @ValidateNested()
  @Type(() => InvoiceClientDto)
  client: InvoiceClientDto;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InvoiceItemLineDto)
  items: InvoiceItemLineDto[];

  @IsDefined()
  @ValidateNested()
  @Type(() => InvoiceBillingDto)
  billing: InvoiceBillingDto;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsIn(PAYMENT_METHODS, { each: true })
  paymentMethods: PaymentMethod[];

  @IsOptional()
  @ValidateNested()
  @Type(() => InvoiceDiscountDto)
  discount?: InvoiceDiscountDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => InterestAndFineDto)
  interestAndFine?: InterestAndFineDto;
}
