import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { UpdateNotificationSettingsDto } from './dto/update-notification-settings.dto.js';
import {
  NOTIFICATION_SETTINGS_SELECT,
  NotificationSettings,
} from './notifications.constants.js';

/** E-mails automáticos que a organização envia aos pagadores. */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(organizationId: string): Promise<NotificationSettings> {
    const settings = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: NOTIFICATION_SETTINGS_SELECT,
    });

    if (!settings) {
      throw new NotFoundException('Organização não encontrada');
    }

    return settings;
  }

  update(
    organizationId: string,
    dto: UpdateNotificationSettingsDto,
  ): Promise<NotificationSettings> {
    return this.prisma.organization.update({
      where: { id: organizationId },
      data: {
        notifyInvoiceIssued: dto.notifyInvoiceIssued,
        notifyInvoiceReminder: dto.notifyInvoiceReminder,
        invoiceReminderDays: dto.invoiceReminderDays,
        notifyInvoiceOverdue: dto.notifyInvoiceOverdue,
        notifyInvoicePaid: dto.notifyInvoicePaid,
      },
      select: NOTIFICATION_SETTINGS_SELECT,
    });
  }
}
