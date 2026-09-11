import { Controller, Get, Post, Req, Res } from '@nestjs/common';
import * as express from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import { Public } from './decorators.js';
import { CurrentUser, CurrentSession, ActiveOrgId } from './decorators.js';
import { auth } from './auth.config.js';

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

  /**
   * Encerra a sessão do usuário autenticado (logout).
   * Revoga o token da sessão atual via Better Auth.
   */
  @Post('logout')
  async logout(@Req() req: express.Request, @Res() res: express.Response) {
    await auth.api.revokeSession({
      headers: fromNodeHeaders(req.headers),
      body: {
        token: (req as any).session?.token,
      },
    });

    // Limpar cookie de sessão
    res.clearCookie('better-auth.session_token', {
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    });

    return res.json({ success: true, message: 'Sessão encerrada com sucesso' });
  }

  /**
   * Lista todas as organizações das quais o usuário autenticado é membro.
   */
  @Get('organizations')
  async listOrganizations(@Req() req: express.Request) {
    const orgs = await auth.api.listOrganizations({
      headers: fromNodeHeaders(req.headers),
    });

    return orgs;
  }
}

