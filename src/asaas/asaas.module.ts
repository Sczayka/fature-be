import { Module } from '@nestjs/common';
import { AsaasService } from './asaas.service.js';
import { AsaasListener } from './asaas.listener.js';

@Module({
  providers: [AsaasService, AsaasListener],
  exports: [AsaasService],
})
export class AsaasModule {}
