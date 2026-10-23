import { PartialType } from '@nestjs/mapped-types';
import { IsOptionalNotNull } from '../../../common/decorators/is-optional-not-null.decorator.js';
import { IsDay, IsFinancialAmount } from '../../dto/financial-validators.js';
import { PayableFieldsDto } from './payable-fields.dto.js';

/**
 * Edição de uma conta da série (as outras não mudam). Campo ausente não muda nada; null limpa os
 * opcionais. O pagamento muda pela baixa: desfaça e pague de novo.
 */
export class UpdatePayableDto extends PartialType(PayableFieldsDto, {
  skipNullProperties: false,
}) {
  @IsOptionalNotNull()
  @IsFinancialAmount()
  amount?: number;

  @IsOptionalNotNull()
  @IsDay('o vencimento')
  dueDate?: string;
}
