import {
  Body,
  Controller,
  Get,
  Put,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { ActiveOrgId } from '../../auth/decorators.js';
import { OrganizationGuard } from '../../auth/organization.guard.js';
import { PayloadValidationPipe } from '../../common/pipes/payload-validation.pipe.js';
import { UpdateNotificationSettingsDto } from './dto/update-notification-settings.dto.js';
import { NotificationsService } from './notifications.service.js';

/** Aba "Notificações" das configurações da organização ativa. */
@UseGuards(OrganizationGuard)
@UsePipes(PayloadValidationPipe)
@Controller('organizations/notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  get(@ActiveOrgId() orgId: string) {
    return this.notificationsService.get(orgId);
  }

  @Put()
  update(
    @ActiveOrgId() orgId: string,
    @Body() dto: UpdateNotificationSettingsDto,
  ) {
    return this.notificationsService.update(orgId, dto);
  }
}
