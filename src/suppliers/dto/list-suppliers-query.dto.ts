import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { ListQueryDto } from '../../common/dto/list-query.dto.js';
import {
  queryBoolean,
  trim,
  unmaskToNull,
} from '../../common/dto/transforms.js';

/** Filtros de GET /suppliers; ausentes, listam tudo. */
export class ListSuppliersQueryDto extends ListQueryDto {
  /** Razão social, nome da pessoa ou nome fantasia. */
  @Transform(trim)
  @IsOptional()
  @IsString()
  name?: string;

  /** Parte do documento, com ou sem a pontuação. */
  @Transform(unmaskToNull)
  @IsOptional()
  @IsString()
  cpfCnpj?: string | null;

  @Transform(queryBoolean)
  @IsOptional()
  @IsBoolean({
    message: 'Situação inválida: use true (ativos) ou false (inativos)',
  })
  active?: boolean;
}
