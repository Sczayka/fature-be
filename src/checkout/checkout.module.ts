import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { PaymentsModule } from '../payments/payments.module.js';
import { CheckoutController } from './checkout.controller.js';
import { CheckoutService } from './checkout.service.js';

const MINUTE_MS = 60_000;

@Module({
  imports: [
    PaymentsModule,
    ThrottlerModule.forRoot({
      throttlers: [
        // Requisições por IP em todas as rotas do checkout
        { name: 'ip', ttl: MINUTE_MS, limit: 60 },
        // Tentativas de cartão por fatura, de qualquer IP (barra teste de cartões roubados)
        {
          name: 'card',
          ttl: 60 * MINUTE_MS,
          limit: 5,
          getTracker: (request) => `card:${request.params?.token}`,
        },
      ],
      errorMessage:
        'Muitas tentativas. Aguarde alguns minutos e tente novamente.',
    }),
  ],
  controllers: [CheckoutController],
  providers: [CheckoutService],
})
export class CheckoutModule {}
