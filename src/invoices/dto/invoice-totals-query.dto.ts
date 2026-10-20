import { IsOptional, IsString } from 'class-validator';

/** GET /invoices/totals: sem o cliente, soma as faturas da organização inteira. */
export class InvoiceTotalsQueryDto {
  @IsOptional()
  @IsString()
  clientId?: string;
}
