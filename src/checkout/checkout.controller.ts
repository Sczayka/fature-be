import {
  Body,
  Controller,
  Get,
  HttpCode,
  Ip,
  Param,
  Post,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { SkipThrottle, ThrottlerGuard } from '@nestjs/throttler';
import { Public } from '../auth/decorators.js';
import { PayloadValidationPipe } from '../common/pipes/payload-validation.pipe.js';
import { CheckoutService } from './checkout.service.js';
import { PayWithCreditCardDto } from './dto/pay-with-credit-card.dto.js';

/**
 * Página pública de pagamento (/pagar/{token} no fature-fe). Sem sessão: o token opaco da
 * fatura é a credencial. Limites: por IP em todas as rotas e por fatura nas tentativas de cartão.
 */
@Public()
@UseGuards(ThrottlerGuard)
@SkipThrottle({ card: true })
@UsePipes(PayloadValidationPipe)
@Controller('checkout')
export class CheckoutController {
  constructor(private readonly checkoutService: CheckoutService) {}

  @Get(':token')
  getView(@Param('token') token: string) {
    return this.checkoutService.getView(token);
  }

  @Get(':token/status')
  getStatus(@Param('token') token: string) {
    return this.checkoutService.getStatus(token);
  }

  @Post(':token/pix')
  @HttpCode(200)
  createPix(@Param('token') token: string) {
    return this.checkoutService.createPix(token);
  }

  @Post(':token/credit-card')
  @HttpCode(200)
  @SkipThrottle({ card: false })
  payWithCreditCard(
    @Param('token') token: string,
    @Body() dto: PayWithCreditCardDto,
    @Ip() payerIp: string,
  ) {
    return this.checkoutService.payWithCreditCard(token, dto, payerIp);
  }
}
