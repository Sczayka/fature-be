import { IsIn } from 'class-validator';
import {
  MANUAL_PAYMENT_METHODS,
  type ManualPaymentMethod,
} from '../../payments/manual/manual-payments.constants.js';

/** Comprovante do pagador (multipart, com o arquivo no campo `file`). */
export class UploadReceiptDto {
  @IsIn(MANUAL_PAYMENT_METHODS, {
    message: 'Forma de pagamento inválida: use PIX ou transferência bancária',
  })
  method: ManualPaymentMethod;
}
