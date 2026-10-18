import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  ParseFilePipeBuilder,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  UsePipes,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ActiveOrgId } from '../../auth/decorators.js';
import { OrganizationGuard } from '../../auth/organization.guard.js';
import { PayloadValidationPipe } from '../../common/pipes/payload-validation.pipe.js';
import { LOGO_MAX_BYTES, LOGO_MIME_TYPES } from './customization.constants.js';
import {
  CustomizationService,
  type UploadedLogo,
} from './customization.service.js';
import { UpdateCustomizationDto } from './dto/update-customization.dto.js';

const logoFilePipe = new ParseFilePipeBuilder()
  .addFileTypeValidator({
    fileType: LOGO_MIME_TYPES,
    errorMessage: 'O logo deve ser uma imagem PNG, JPEG ou WebP',
  })
  .addMaxSizeValidator({
    maxSize: LOGO_MAX_BYTES,
    message: 'O logo deve ter no máximo 512 KB',
  })
  .build({ errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY });

/** Aba "Customização" das configurações da organização ativa. */
@UseGuards(OrganizationGuard)
@UsePipes(PayloadValidationPipe)
@Controller('organizations/customization')
export class CustomizationController {
  constructor(private readonly customizationService: CustomizationService) {}

  @Get()
  get(@ActiveOrgId() orgId: string) {
    return this.customizationService.get(orgId);
  }

  @Put()
  update(@ActiveOrgId() orgId: string, @Body() dto: UpdateCustomizationDto) {
    return this.customizationService.update(orgId, dto);
  }

  /** multipart/form-data com o campo `file`. */
  @Put('logo')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: LOGO_MAX_BYTES } }),
  )
  uploadLogo(
    @ActiveOrgId() orgId: string,
    @UploadedFile(logoFilePipe) file: UploadedLogo,
  ) {
    return this.customizationService.uploadLogo(orgId, file);
  }

  @Delete('logo')
  removeLogo(@ActiveOrgId() orgId: string) {
    return this.customizationService.removeLogo(orgId);
  }
}
