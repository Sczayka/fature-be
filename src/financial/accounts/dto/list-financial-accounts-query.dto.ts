import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { queryBoolean } from '../../../common/dto/transforms.js';

/** GET /financial/accounts: sem `active`, lista as ativas e as inativas. */
export class ListFinancialAccountsQueryDto {
  @Transform(queryBoolean)
  @IsOptional()
  @IsBoolean({
    message: 'Situação inválida: use true (ativas) ou false (inativas)',
  })
  active?: boolean;
}
