import { Module } from '@nestjs/common';
import { StorageService } from './storage.service.js';

/** Armazenamento de arquivos privados (Cloudflare R2). */
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
