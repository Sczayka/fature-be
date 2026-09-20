import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Guard que exige que a organização ativa tenha um gateway de pagamento ACTIVE.
 * Use com @UseGuards(OrganizationGuard, ActiveGatewayGuard) em rotas de billing.
 */
@Injectable()
export class ActiveGatewayGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const orgId = request.session?.activeOrganizationId;

    if (!orgId) {
      throw new ForbiddenException('Organização ativa não encontrada');
    }

    const gateway = await this.prisma.paymentGatewayAccount.findUnique({
      where: {
        organizationId_provider: {
          organizationId: orgId,
          provider: 'ASAAS',
        },
      },
      select: { status: true },
    });

    if (!gateway || gateway.status !== 'ACTIVE') {
      throw new ForbiddenException(
        'Configure os dados da empresa antes de criar cobranças',
      );
    }

    return true;
  }
}
