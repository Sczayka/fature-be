import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  ValidateNested,
} from 'class-validator';
import { PAYMENT_METHODS } from '../../invoices.constants.js';
import type { PaymentMethod } from '../../invoices.constants.js';
import {
  DraftBillingDto,
  InterestAndFineDto,
  InvoiceClientDto,
  InvoiceDiscountDto,
  InvoiceItemLineDto,
} from '../../dto/invoice-sections.dto.js';

/**
 * Orçamento: mesmas seções do payload de invoice, todas opcionais e validadas só quanto
 * ao formato (sem as regras de emissão de cobrança).
 */
export class CreateInvoiceDraftDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => InvoiceClientDto)
  client?: InvoiceClientDto | null;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InvoiceItemLineDto)
  items?: InvoiceItemLineDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => DraftBillingDto)
  billing?: DraftBillingDto | null;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(PAYMENT_METHODS, { each: true })
  paymentMethods?: PaymentMethod[];

  @IsOptional()
  @ValidateNested()
  @Type(() => InvoiceDiscountDto)
  discount?: InvoiceDiscountDto | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => InterestAndFineDto)
  interestAndFine?: InterestAndFineDto | null;
}
