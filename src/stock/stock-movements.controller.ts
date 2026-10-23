import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { ActiveOrgId, CurrentUser } from '../auth/decorators.js';
import { OrganizationGuard } from '../auth/organization.guard.js';
import { ListQueryDto } from '../common/dto/list-query.dto.js';
import { PayloadValidationPipe } from '../common/pipes/payload-validation.pipe.js';
import { CreateStockMovementDto } from './dto/create-stock-movement.dto.js';
import { StockService } from './stock.service.js';

/** Aba "Estoque" do produto: o histórico e os lançamentos da empresa (a venda vem da cobrança). */
@UseGuards(OrganizationGuard)
@UsePipes(PayloadValidationPipe)
@Controller('items/:itemId/stock-movements')
export class StockMovementsController {
  constructor(private readonly stockService: StockService) {}

  @Get()
  findAll(
    @ActiveOrgId() orgId: string,
    @Param('itemId') itemId: string,
    @Query() query: ListQueryDto,
  ) {
    return this.stockService.findMovements(itemId, orgId, query);
  }

  @Post()
  create(
    @ActiveOrgId() orgId: string,
    @Param('itemId') itemId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateStockMovementDto,
  ) {
    return this.stockService.createMovement(itemId, orgId, userId, dto);
  }
}
