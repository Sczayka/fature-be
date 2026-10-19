import { PartialType } from '@nestjs/mapped-types';
import { CreateItemDto } from './create-item.dto.js';

/** Campo ausente não muda nada; os obrigatórios do cadastro não aceitam null. */
export class UpdateItemDto extends PartialType(CreateItemDto, {
  skipNullProperties: false,
}) {}
