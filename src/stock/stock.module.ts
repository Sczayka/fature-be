import { Module } from '@nestjs/common';
import { StockMovementsController } from './stock-movements.controller.js';
import { StockService } from './stock.service.js';

/** O cadastro do produto grava o saldo inicial e a emissão da cobrança dá baixa pelo StockService. */
@Module({
  controllers: [StockMovementsController],
  providers: [StockService],
  exports: [StockService],
})
export class StockModule {}
