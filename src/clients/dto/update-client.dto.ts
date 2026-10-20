import { PartialType } from '@nestjs/mapped-types';
import { CreateClientDto } from './create-client.dto.js';

/** Campo ausente não muda nada; null (ou vazio) limpa os opcionais. */
export class UpdateClientDto extends PartialType(CreateClientDto, {
  skipNullProperties: false,
}) {}
