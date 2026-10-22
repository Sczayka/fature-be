import { PartialType } from '@nestjs/mapped-types';
import { CreatePromotionDto } from './create-promotion.dto.js';

/** Campo ausente não muda nada; null tira o teto, a quantidade máxima ou a data. */
export class UpdatePromotionDto extends PartialType(CreatePromotionDto, {
  skipNullProperties: false,
}) {}
