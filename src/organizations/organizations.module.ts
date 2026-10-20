import { Module } from '@nestjs/common';
import { OrganizationsService } from './organizations.service.js';
import { OrganizationsController } from './organizations.controller.js';
import { BankAccountController } from './bank-account/bank-account.controller.js';
import { BankAccountService } from './bank-account/bank-account.service.js';
import { CustomizationController } from './customization/customization.controller.js';
import { CustomizationService } from './customization/customization.service.js';
import { LogosController } from './customization/logos.controller.js';
import { NotificationsController } from './notifications/notifications.controller.js';
import { NotificationsService } from './notifications/notifications.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PaymentsModule } from '../payments/payments.module.js';

@Module({
  imports: [PrismaModule, PaymentsModule],
  controllers: [
    OrganizationsController,
    CustomizationController,
    LogosController,
    NotificationsController,
    BankAccountController,
  ],
  providers: [
    OrganizationsService,
    CustomizationService,
    NotificationsService,
    BankAccountService,
  ],
})
export class OrganizationsModule {}
