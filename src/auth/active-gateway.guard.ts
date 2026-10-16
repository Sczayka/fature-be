import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PaymentRoutingService } from '../payments/payment-routing.service.js';

/**
 * Guard que exige ao menos um método de pagamento disponível para a organização ativa
 * (conta ativa no provedor padrão do método).
 * Use com @UseGuards(OrganizationGuard, ActiveGatewayGuard) em rotas de billing.
 */
@Injectable()
export class ActiveGatewayGuard implements CanActivate {
  constructor(private readonly routing: PaymentRoutingService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const orgId = request.session?.activeOrganizationId;

    if (!orgId) {
      throw new ForbiddenException('Organização ativa não encontrada');
    }

    const methods = await this.routing.listMethods(orgId);

    if (!methods.some((method) => method.available)) {
      throw new ForbiddenException(
        'Configure os dados da empresa antes de criar cobranças',
      );
    }

    return true;
  }
}
