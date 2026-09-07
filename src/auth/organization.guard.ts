import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

/**
 * Guard que exige que o usuário tenha uma organização ativa na sessão.
 * Use com @UseGuards(OrganizationGuard) em rotas que exigem contexto de organização.
 */
@Injectable()
export class OrganizationGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const activeOrgId = request.session?.activeOrganizationId;

    if (!activeOrgId) {
      throw new ForbiddenException(
        'É necessário selecionar uma organização ativa',
      );
    }

    return true;
  }
}
