import {
  BadRequestException,
  Controller,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../../auth/decorators.js';
import { PaymentEventsService } from '../payment-events.service.js';
import { toPaymentHttpException } from '../payment-errors.js';
import type { PaymentEvent } from '../providers/payment-provider.js';
import { PaymentProviderRegistry } from '../providers/payment-provider.registry.js';

/**
 * Webhooks dos provedores: POST /webhooks/{provedor}. O adaptador autentica a chamada (token
 * ou assinatura do corpo bruto) e normaliza os eventos; o núcleo aplica.
 */
@Public()
@Controller('webhooks')
export class WebhooksController {
  constructor(
    private readonly registry: PaymentProviderRegistry,
    private readonly paymentEvents: PaymentEventsService,
  ) {}

  @Post(':provider')
  @HttpCode(200)
  async receive(
    @Param('provider') providerCode: string,
    @Req() request: RawBodyRequest<Request>,
  ) {
    const provider = this.registry.find(providerCode.toUpperCase());

    if (!provider) {
      throw new NotFoundException('Provedor de pagamento desconhecido');
    }

    let events: PaymentEvent[];

    try {
      events = provider.parseWebhook({
        headers: request.headers,
        rawBody: request.rawBody ?? Buffer.alloc(0),
      });
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new BadRequestException('Corpo do webhook inválido');
      }

      throw toPaymentHttpException(error, 'Webhook');
    }

    await this.paymentEvents.handle(provider.code, events);

    return { received: true };
  }
}
