import { IsIn, IsOptional } from 'class-validator';
import {
  RECEIPTS_PERIOD_KEYS,
  type ReceiptsPeriod,
} from '../dashboard.constants.js';

/** GET /dashboard/receipts: sem o período, os últimos 6 meses. */
export class DashboardReceiptsQueryDto {
  @IsOptional()
  @IsIn(RECEIPTS_PERIOD_KEYS, {
    message:
      'Período inválido: use 30d (últimos 30 dias), 6m (últimos 6 meses) ou 12m (últimos 12 meses)',
  })
  period?: ReceiptsPeriod;
}
