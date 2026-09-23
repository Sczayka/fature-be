import { IsString, IsNumber, IsArray, IsObject, IsDateString, IsOptional } from 'class-validator';

export class CreateInvoiceDto {

  @IsString()
  clientId: string;

  @IsArray()
  items: Array<{ id: string; name: string; price: number; quantity: number; total: number }>;

  @IsNumber()
  totalValue: number;

  @IsDateString()
  dueDate: string;

  @IsObject()
  paymentMethods: Record<string, any>;
}
