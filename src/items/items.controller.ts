import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  UsePipes,
  Query,
} from '@nestjs/common';
import { ItemsService } from './items.service.js';
import { CreateItemDto } from './dto/create-item.dto.js';
import { ItemStockQueryDto } from './dto/item-stock-query.dto.js';
import { ListItemsQueryDto } from './dto/list-items-query.dto.js';
import { UpdateItemDto } from './dto/update-item.dto.js';
import { OrganizationGuard } from '../auth/organization.guard.js';
import { ActiveOrgId, CurrentUser } from '../auth/decorators.js';
import { PayloadValidationPipe } from '../common/pipes/payload-validation.pipe.js';

@UseGuards(OrganizationGuard)
@UsePipes(PayloadValidationPipe)
@Controller('items')
export class ItemsController {
  constructor(private readonly itemsService: ItemsService) {}

  @Post()
  create(
    @ActiveOrgId() orgId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateItemDto,
  ) {
    return this.itemsService.create(orgId, dto, userId);
  }

  @Get()
  findAll(@ActiveOrgId() orgId: string, @Query() query: ListItemsQueryDto) {
    return this.itemsService.findAll(orgId, query);
  }

  @Get('search')
  search(@ActiveOrgId() orgId: string, @Query('q') query: string) {
    if (!query || query.trim().length === 0) {
      return [];
    }
    return this.itemsService.search(orgId, query.trim());
  }

  /** Saldo dos produtos da cobrança, para o aviso de estoque insuficiente (antes de `:id`). */
  @Get('stock')
  stock(@ActiveOrgId() orgId: string, @Query() query: ItemStockQueryDto) {
    return this.itemsService.stockOf(orgId, query.ids);
  }

  /** Produtos a repor, para o alerta no menu e na lista (antes de `:id`). */
  @Get('low-stock/count')
  lowStockCount(@ActiveOrgId() orgId: string) {
    return this.itemsService.lowStockCount(orgId);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @ActiveOrgId() orgId: string) {
    return this.itemsService.findOne(id, orgId);
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @ActiveOrgId() orgId: string,
    @Body() dto: UpdateItemDto,
  ) {
    return this.itemsService.update(id, orgId, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @ActiveOrgId() orgId: string) {
    return this.itemsService.remove(id, orgId);
  }
}
