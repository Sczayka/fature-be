import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';
import { ListQueryDto } from '../../common/dto/list-query.dto.js';
import { queryBoolean, trim } from '../../common/dto/transforms.js';
import {
  ITEM_TYPES,
  type ItemType,
} from '../../invoices/invoices.constants.js';

/** Filtros de GET /items; ausentes, listam tudo. */
export class ListItemsQueryDto extends ListQueryDto {
  @Transform(trim)
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsIn(ITEM_TYPES, {
    message: 'Tipo inválido: use product (produto) ou service (serviço)',
  })
  type?: ItemType;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'O valor deve ser um número' })
  price?: number;

  @IsOptional()
  @IsString()
  brandId?: string;

  /** Também restringe os fornecedores de cada item ao vínculo com este. */
  @IsOptional()
  @IsString()
  supplierId?: string;

  /** Só os produtos a repor: com o saldo no estoque mínimo ou abaixo. */
  @Transform(queryBoolean)
  @IsOptional()
  @IsBoolean({ message: 'Use true ou false no filtro de estoque mínimo' })
  lowStock?: boolean;
}
