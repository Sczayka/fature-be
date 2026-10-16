import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PaymentProviderError } from './providers/payment-provider.js';

/** Converte erros tratados dos provedores em respostas HTTP; os demais seguem como estão. */
export function toPaymentHttpException(
  error: unknown,
  prefix: string,
): unknown {
  if (!(error instanceof PaymentProviderError)) return error;

  switch (error.kind) {
    case 'INVALID_DATA':
      return new BadRequestException(`${prefix}: ${error.message}`);
    case 'CARD_REFUSED':
      return new UnprocessableEntityException(error.message);
    case 'UNAUTHORIZED':
      return new HttpException(error.message, 401);
    default:
      return new BadGatewayException(`${prefix}: ${error.message}`);
  }
}
