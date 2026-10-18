import { Module } from '@nestjs/common';
import { OrganizationsService } from './organizations.service.js';
import { OrganizationsController } from './organizations.controller.js';
import { CustomizationController } from './customization/customization.controller.js';
import { CustomizationService } from './customization/customization.service.js';
import { LogosController } from './customization/logos.controller.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PaymentsModule } from '../payments/payments.module.js';

@Module({
  imports: [PrismaModule, PaymentsModule],
  controllers: [
    OrganizationsController,
    CustomizationController,
    LogosController,
  ],
  providers: [OrganizationsService, CustomizationService],
})
export class OrganizationsModule {}
