import {
  SetMetadata,
  createParamDecorator,
  ExecutionContext,
} from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marca uma rota como pública (não requer autenticação).
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Extrai o usuário autenticado do request.
 * Uso: @CurrentUser() user
 * Ou para um campo específico: @CurrentUser('id') userId
 */
export const CurrentUser = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;
    return data ? user?.[data] : user;
  },
);

/**
 * Extrai a sessão atual do request.
 * Uso: @CurrentSession() session
 */
export const CurrentSession = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const session = request.session;
    return data ? session?.[data] : session;
  },
);

/**
 * Extrai o ID da organização ativa da sessão.
 * Uso: @ActiveOrgId() orgId: string | null
 */
export const ActiveOrgId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.session?.activeOrganizationId ?? null;
  },
);
