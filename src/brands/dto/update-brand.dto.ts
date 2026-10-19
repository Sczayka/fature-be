import { PartialType } from '@nestjs/mapped-types';
import { CreateBrandDto } from './create-brand.dto.js';

/** Campo ausente não muda nada; inativar é enviar `active: false`. */
export class UpdateBrandDto extends PartialType(CreateBrandDto, {
  skipNullProperties: false,
}) {}
