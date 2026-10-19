import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { ItemsModule } from './items/items.module.js';
import { ClientsModule } from './clients/clients.module.js';
import { OrganizationsModule } from './organizations/organizations.module.js';
import { PaymentsModule } from './payments/payments.module.js';
import { InvoicesModule } from './invoices/invoices.module.js';
import { CheckoutModule } from './checkout/checkout.module.js';
import { EmailModule } from './email/email.module.js';

@Module({
  imports: [
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    AuthModule,
    PrismaModule,
    ItemsModule,
    ClientsModule,
    OrganizationsModule,
    PaymentsModule,
    InvoicesModule,
    CheckoutModule,
    EmailModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
