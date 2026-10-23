import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { ListQueryDto } from '../../../common/dto/list-query.dto.js';
import { trim } from '../../../common/dto/transforms.js';
import { IsDay } from '../../dto/financial-validators.js';

/** Em aberto (a vencer e vencidas), só a vencer, só vencidas ou pagas. */
export const PAYABLE_STATUS_FILTERS = [
  'PENDING',
  'OPEN',
  'OVERDUE',
  'PAID',
] as const;

export type PayableStatusFilter = (typeof PAYABLE_STATUS_FILTERS)[number];

/** O período filtra pelo vencimento ou pela data do pagamento. */
export const PAYABLE_DATE_FIELDS = ['dueDate', 'paymentDate'] as const;

export type PayableDateField = (typeof PAYABLE_DATE_FIELDS)[number];

/** Filtros de GET /financial/payables; ausentes, listam tudo. */
export class ListPayablesQueryDto extends ListQueryDto {
  @IsOptional()
  @IsIn(PAYABLE_STATUS_FILTERS, {
    message: 'Situação inválida: use PENDING, OPEN, OVERDUE ou PAID',
  })
  status?: PayableStatusFilter;

  @IsOptional()
  @IsIn(PAYABLE_DATE_FIELDS, {
    message:
      'Período inválido: use dueDate (vencimento) ou paymentDate (pagamento)',
  })
  dateField?: PayableDateField;

  @IsOptional()
  @IsDay('o início do período')
  from?: string;

  @IsOptional()
  @IsDay('o fim do período')
  to?: string;

  @IsOptional()
  @IsString()
  supplierId?: string;

  @IsOptional()
  @IsString()
  employeeId?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  /** Descrição, documento, fornecedor ou funcionário. */
  @Transform(trim)
  @IsOptional()
  @IsString()
  q?: string;
}
