import { Transform } from 'class-transformer';
import { IsOptional, IsString } from 'class-validator';
import { ListQueryDto } from '../../common/dto/list-query.dto.js';
import { trim } from '../../common/dto/transforms.js';

/** Filtros de GET /clients; ausentes, listam todos. */
export class ListClientsQueryDto extends ListQueryDto {
  @Transform(trim)
  @IsOptional()
  @IsString()
  name?: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  email?: string;

  /** Procura no telefone e no celular. */
  @Transform(trim)
  @IsOptional()
  @IsString()
  phone?: string;
}
