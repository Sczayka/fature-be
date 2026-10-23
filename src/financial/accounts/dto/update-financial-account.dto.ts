import { PartialType } from '@nestjs/mapped-types';
import { CreateFinancialAccountDto } from './create-financial-account.dto.js';

/** Campo ausente não muda nada; inativar é enviar `active: false`. */
export class UpdateFinancialAccountDto extends PartialType(
  CreateFinancialAccountDto,
  { skipNullProperties: false },
) {}
