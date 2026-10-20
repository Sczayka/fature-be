import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';
import { queryBoolean } from '../../common/dto/transforms.js';
import { ListQueryDto } from '../../common/dto/list-query.dto.js';
import { INVOICE_STATUSES, type InvoiceStatus } from '../invoices.constants.js';

/** Filtros de GET /invoices; ausentes, listam todas. */
export class ListInvoicesQueryDto extends ListQueryDto {
  @IsOptional()
  @IsString()
  clientId?: string;

  /** Status exibido: OVERDUE inclui a pendente com o vencimento passado. */
  @IsOptional()
  @IsIn(INVOICE_STATUSES, {
    message:
      'Status inválido: use PENDING (pendente), AWAITING_CONFIRMATION (aguardando conferência), OVERDUE (vencida), PAID (paga) ou CANCELLED (cancelada)',
  })
  status?: InvoiceStatus;

  /** true: só as faturas com excedente recebido e ainda não devolvido. */
  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean({ message: 'hasExcess deve ser true ou false' })
  hasExcess?: boolean;
}
