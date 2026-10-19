import { PartialType } from '@nestjs/mapped-types';
import { CreateSupplierDto } from './create-supplier.dto.js';

/** Campo ausente não muda nada; null limpa os opcionais; inativar é enviar `active: false`. */
export class UpdateSupplierDto extends PartialType(CreateSupplierDto, {
  skipNullProperties: false,
}) {}
