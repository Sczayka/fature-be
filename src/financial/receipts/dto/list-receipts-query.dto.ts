import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { ListQueryDto } from '../../../common/dto/list-query.dto.js';
import { trim } from '../../../common/dto/transforms.js';
import { RECEIPT_ORIGINS } from '../../financial.constants.js';
import { IsDay } from '../../dto/financial-validators.js';

/**
 * Filtros de GET /financial/receipts e de /financial/receipts/totals (que ignora a página).
 * O período é pela data do recebimento; ausentes, listam tudo.
 */
export class ListReceiptsQueryDto extends ListQueryDto {
  @IsOptional()
  @IsDay('o início do período')
  from?: string;

  @IsOptional()
  @IsDay('o fim do período')
  to?: string;

  @IsOptional()
  @IsString()
  accountId?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  clientId?: string;

  /** MANUAL (lançados pela empresa) ou INVOICE (das faturas). */
  @IsOptional()
  @IsIn(RECEIPT_ORIGINS, {
    message: 'Origem inválida: use MANUAL ou INVOICE',
  })
  origin?: string;

  /** Descrição, documento ou nome do cliente. */
  @Transform(trim)
  @IsOptional()
  @IsString()
  q?: string;
}
