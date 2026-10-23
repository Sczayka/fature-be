import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsString,
  MaxLength,
} from 'class-validator';
import { IsOptionalNotNull } from '../../../common/decorators/is-optional-not-null.decorator.js';
import { trim } from '../../../common/dto/transforms.js';
import {
  ENTRY_DIRECTIONS,
  FINANCIAL_CATEGORY_NAME_MAX_LENGTH,
  type EntryDirection,
} from '../../financial.constants.js';

/** Categoria de receita (IN) ou de despesa (OUT). */
export class CreateFinancialCategoryDto {
  @Transform(trim)
  @IsString({ message: 'Informe o nome da categoria' })
  @IsNotEmpty({ message: 'Informe o nome da categoria' })
  @MaxLength(FINANCIAL_CATEGORY_NAME_MAX_LENGTH, {
    message: `O nome da categoria deve ter no máximo ${FINANCIAL_CATEGORY_NAME_MAX_LENGTH} caracteres`,
  })
  name: string;

  @IsIn(ENTRY_DIRECTIONS, {
    message: 'Tipo inválido: use IN (receita) ou OUT (despesa)',
  })
  direction: EntryDirection;

  /** Ausente no cadastro: ativa. */
  @IsOptionalNotNull()
  @IsBoolean({ message: 'Informe se a categoria está ativa' })
  active?: boolean;
}
