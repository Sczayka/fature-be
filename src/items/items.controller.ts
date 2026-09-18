import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  Query,
} from '@nestjs/common';
import { ItemsService } from './items.service.js';
import { CreateItemDto } from './dto/create-item.dto.js';
import { UpdateItemDto } from './dto/update-item.dto.js';
import { OrganizationGuard } from '../auth/organization.guard.js';
import { ActiveOrgId } from '../auth/decorators.js';

@UseGuards(OrganizationGuard)
@Controller('items')
export class ItemsController {
  constructor(private readonly ItemsService: ItemsService) {}

  @Post()
  create(
    @ActiveOrgId() orgId: string,
    @Body() dto: CreateItemDto,
  ) {
    return this.ItemsService.create(orgId, dto);
  }

  @Get()
  findAll(
    @ActiveOrgId() orgId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('name') name?: string,
    @Query('type') type?: string,
    @Query('price') price?: string,
    @Query('createdAt') createdAt?: string,
  ) {
    const pageNumber = page ? parseInt(page, 10) : 1;
    const limitNumber = limit ? parseInt(limit, 10) : 10;
    const priceNumber = price ? parseFloat(price) : undefined;
    return this.ItemsService.findAll(orgId, pageNumber, limitNumber, { name, type, price: priceNumber, createdAt });
  }

  @Get('search')
  search(
    @ActiveOrgId() orgId: string,
    @Query('q') query: string,
  ) {
    if (!query || query.trim().length === 0) {
      return [];
    }
    return this.ItemsService.search(orgId, query.trim());
  }

  @Get(':id')
  findOne(
    @Param('id') id: string,
    @ActiveOrgId() orgId: string,
  ) {
    return this.ItemsService.findOne(id, orgId);
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @ActiveOrgId() orgId: string,
    @Body() dto: UpdateItemDto,
  ) {
    return this.ItemsService.update(id, orgId, dto);
  }

  @Delete(':id')
  remove(
    @Param('id') id: string,
    @ActiveOrgId() orgId: string,
  ) {
    return this.ItemsService.remove(id, orgId);
  }
}
