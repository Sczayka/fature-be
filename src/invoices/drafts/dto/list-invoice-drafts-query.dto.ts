import { IsOptional, IsString } from 'class-validator';
import { ListQueryDto } from '../../../common/dto/list-query.dto.js';

/** Filtros de GET /invoices/drafts; ausentes, listam todos. */
export class ListInvoiceDraftsQueryDto extends ListQueryDto {
  /** Cliente cadastrado do orçamento (o id gravado no JSON do bloco client). */
  @IsOptional()
  @IsString()
  clientId?: string;
}
