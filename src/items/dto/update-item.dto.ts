import { OmitType, PartialType } from '@nestjs/mapped-types';
import { IsEmpty } from 'class-validator';
import { CreateItemDto } from './create-item.dto.js';

/** Campo ausente não muda nada; os obrigatórios do cadastro não aceitam null. */
export class UpdateItemDto extends PartialType(
  OmitType(CreateItemDto, ['stock']),
  { skipNullProperties: false },
) {
  /** O saldo muda só pelas movimentações (POST /items/:itemId/stock-movements). */
  @IsEmpty({
    message:
      'O estoque não é editado no cadastro: registre uma entrada, uma devolução ou um ajuste',
  })
  stock?: never;
}
