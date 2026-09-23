import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { ItemsModule } from './items/items.module.js';
import { ClientsModule } from './clients/clients.module.js';
import { OrganizationsModule } from './organizations/organizations.module.js';
import { AsaasModule } from './asaas/asaas.module.js';
import { InvoicesModule } from './invoices/invoices.module.js';

@Module({
  imports: [
    EventEmitterModule.forRoot(),
    AuthModule,
    PrismaModule,
    ItemsModule,
    ClientsModule,
    OrganizationsModule,
    AsaasModule,
    InvoicesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

