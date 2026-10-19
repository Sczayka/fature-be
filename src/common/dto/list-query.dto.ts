import { Type } from 'class-transformer';
import {
  IsInt,
  IsISO8601,
  IsOptional,
  Matches,
  Max,
  Min,
} from 'class-validator';

export const MAX_PAGE_LIMIT = 100;

const LIMIT_MESSAGE = `O limite por página deve ser de 1 a ${MAX_PAGE_LIMIT}`;

/** Paginação e filtro "Criado em" das listagens (GET ?page=&limit=&createdAt=). */
export class ListQueryDto {
  @Type(() => Number)
  @IsInt({ message: 'A página deve ser um número inteiro maior que zero' })
  @Min(1, { message: 'A página deve ser um número inteiro maior que zero' })
  page: number = 1;

  @Type(() => Number)
  @IsInt({ message: LIMIT_MESSAGE })
  @Min(1, { message: LIMIT_MESSAGE })
  @Max(MAX_PAGE_LIMIT, { message: LIMIT_MESSAGE })
  limit: number = 10;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'A data de criação deve estar no formato YYYY-MM-DD',
  })
  @IsISO8601(
    { strict: true },
    { message: 'A data de criação deve ser uma data válida' },
  )
  createdAt?: string;
}
