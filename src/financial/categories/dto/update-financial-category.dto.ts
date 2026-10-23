import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateFinancialCategoryDto } from './create-financial-category.dto.js';

/** O tipo (receita ou despesa) não muda: os lançamentos dela são do mesmo sentido. */
export class UpdateFinancialCategoryDto extends PartialType(
  OmitType(CreateFinancialCategoryDto, ['direction'] as const),
  { skipNullProperties: false },
) {}
