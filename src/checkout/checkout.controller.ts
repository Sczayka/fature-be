import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Ip,
  Param,
  Post,
  Redirect,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  UsePipes,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { SkipThrottle, ThrottlerGuard } from '@nestjs/throttler';
import { Public } from '../auth/decorators.js';
import { PayloadValidationPipe } from '../common/pipes/payload-validation.pipe.js';
import {
  PROOF_MAX_BYTES,
  type UploadedProof,
  proofFilePipe,
} from '../storage/proof-file.js';
import { CheckoutService } from './checkout.service.js';
import { PayWithCreditCardDto } from './dto/pay-with-credit-card.dto.js';
import { UploadReceiptDto } from './dto/upload-receipt.dto.js';

/**
 * Página pública de pagamento (/pagar/{token} no fature-fe). Sem sessão: o token opaco da
 * fatura é a credencial. Limites: por IP em todas as rotas e por fatura nas tentativas de cartão e
 * nos envios de comprovante.
 */
@Public()
@UseGuards(ThrottlerGuard)
@SkipThrottle({ card: true, receipt: true })
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

  /** multipart/form-data com a forma (`method`) e o comprovante no campo `file`. */
  @Post(':token/receipts')
  @SkipThrottle({ card: true, receipt: false })
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: PROOF_MAX_BYTES } }),
  )
  uploadReceipt(
    @Param('token') token: string,
    @Body() dto: UploadReceiptDto,
    @UploadedFile(proofFilePipe) file: UploadedProof,
  ) {
    return this.checkoutService.uploadReceipt(token, dto.method, file);
  }

  @Delete(':token/receipts/:transactionId')
  removeReceipt(
    @Param('token') token: string,
    @Param('transactionId') transactionId: string,
  ) {
    return this.checkoutService.removeReceipt(token, transactionId);
  }

  /** Abre o comprovante: redireciona para a URL assinada, que expira em poucos minutos. */
  @Get(':token/receipts/:transactionId/file')
  @Redirect()
  async receiptFile(
    @Param('token') token: string,
    @Param('transactionId') transactionId: string,
  ) {
    const url = await this.checkoutService.receiptFileUrl(token, transactionId);

    return { url, statusCode: 302 };
  }
}
