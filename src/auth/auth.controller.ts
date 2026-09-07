import { Controller, Get } from '@nestjs/common';
import { Public } from './decorators.js';
import { CurrentUser, CurrentSession, ActiveOrgId } from './decorators.js';

@Controller('auth')
export class AuthController {
  /**
   * Endpoint de health check público para verificar se o serviço de auth está ativo.
   * As rotas de registro/login são gerenciadas automaticamente pelo Better Auth
   * em /api/auth/* (sign-up, sign-in, sign-out, etc.)
   */
  @Public()
  @Get('health')
  health() {
    return { status: 'ok', service: 'auth' };
  }

  /**
   * Retorna os dados do usuário autenticado e sua sessão.
   * Requer autenticação (protegido pelo BetterAuthGuard global).
   */
  @Get('me')
  me(
    @CurrentUser() user: Record<string, unknown>,
    @CurrentSession() session: Record<string, unknown>,
    @ActiveOrgId() activeOrgId: string | null,
  ) {
    return {
      user,
      session,
      activeOrganizationId: activeOrgId,
    };
  }
}
