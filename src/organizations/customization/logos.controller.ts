import {
  Controller,
  Get,
  Param,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle, ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../../auth/decorators.js';
import { CustomizationService } from './customization.service.js';

/**
 * Logos das organizações, públicos para o checkout e os e-mails. A URL gravada em
 * Organization.logo traz a versão (?v=), então o navegador pode guardar a imagem para sempre.
 */
@Public()
@UseGuards(ThrottlerGuard)
// Só o limite por IP: os limites por fatura do checkout não se aplicam aqui
@SkipThrottle({ card: true, receipt: true })
@Controller('logos')
export class LogosController {
  constructor(private readonly customizationService: CustomizationService) {}

  @Get(':organizationId')
  async getLogo(
    @Param('organizationId') organizationId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { data, mimeType } =
      await this.customizationService.findLogo(organizationId);

    response.set({
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    });

    return new StreamableFile(data, { type: mimeType, length: data.length });
  }
}
