import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { ListQueryDto } from '../../common/dto/list-query.dto.js';
import { queryBoolean, trim } from '../../common/dto/transforms.js';

/** Filtros de GET /promotions; ausentes, listam tudo. */
export class ListPromotionsQueryDto extends ListQueryDto {
  @Transform(trim)
  @IsOptional()
  @IsString()
  name?: string;

  @Transform(queryBoolean)
  @IsOptional()
  @IsBoolean({
    message: 'Situação inválida: use true (ativas) ou false (inativas)',
  })
  active?: boolean;
}
