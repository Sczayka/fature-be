import { Module } from '@nestjs/common';
import { StockModule } from '../stock/stock.module.js';
import { ItemsController } from './items.controller.js';
import { ItemsService } from './items.service.js';

@Module({
  imports: [StockModule],
  controllers: [ItemsController],
  providers: [ItemsService],
})
export class ItemsModule {}
