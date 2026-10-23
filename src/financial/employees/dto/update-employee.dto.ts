import { PartialType } from '@nestjs/mapped-types';
import { CreateEmployeeDto } from './create-employee.dto.js';

/** Campo ausente não muda nada; null limpa os opcionais; inativar é enviar `active: false`. */
export class UpdateEmployeeDto extends PartialType(CreateEmployeeDto, {
  skipNullProperties: false,
}) {}
