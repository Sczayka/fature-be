import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import { queryBoolean } from '../../../common/dto/transforms.js';
import {
  ENTRY_DIRECTIONS,
  type EntryDirection,
} from '../../financial.constants.js';

/** GET /financial/categories: sem filtros, receitas e despesas, ativas e inativas. */
export class ListFinancialCategoriesQueryDto {
  @IsOptional()
  @IsIn(ENTRY_DIRECTIONS, {
    message: 'Tipo inválido: use IN (receita) ou OUT (despesa)',
  })
  direction?: EntryDirection;

  @Transform(queryBoolean)
  @IsOptional()
  @IsBoolean({
    message: 'Situação inválida: use true (ativas) ou false (inativas)',
  })
  active?: boolean;
}
