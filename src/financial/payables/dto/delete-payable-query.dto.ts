import { IsIn, IsOptional } from 'class-validator';

/** Só esta conta ou também as próximas da série ainda em aberto (encerra a recorrência). */
export const PAYABLE_DELETE_SCOPES = ['THIS', 'FOLLOWING'] as const;

export type PayableDeleteScope = (typeof PAYABLE_DELETE_SCOPES)[number];

export class DeletePayableQueryDto {
  @IsOptional()
  @IsIn(PAYABLE_DELETE_SCOPES, {
    message: 'Escolha THIS (só esta conta) ou FOLLOWING (esta e as próximas)',
  })
  scope?: PayableDeleteScope;
}
