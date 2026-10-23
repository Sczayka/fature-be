import { IsOptional } from 'class-validator';
import { IsDay } from '../../dto/financial-validators.js';

/** GET /financial/accounts/:id/statement: sem as datas, o mês atual. */
export class StatementQueryDto {
  @IsOptional()
  @IsDay('o início do período')
  from?: string;

  @IsOptional()
  @IsDay('o fim do período')
  to?: string;
}
