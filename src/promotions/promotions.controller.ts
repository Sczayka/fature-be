import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { ActiveOrgId } from '../auth/decorators.js';
import { OrganizationGuard } from '../auth/organization.guard.js';
import { PayloadValidationPipe } from '../common/pipes/payload-validation.pipe.js';
import { AvailablePromotionsQueryDto } from './dto/available-promotions-query.dto.js';
import { CreatePromotionDto } from './dto/create-promotion.dto.js';
import { ListPromotionsQueryDto } from './dto/list-promotions-query.dto.js';
import { UpdatePromotionDto } from './dto/update-promotion.dto.js';
import { PromotionsService } from './promotions.service.js';

@UseGuards(OrganizationGuard)
@UsePipes(PayloadValidationPipe)
@Controller('promotions')
export class PromotionsController {
  constructor(private readonly promotionsService: PromotionsService) {}

  @Post()
  create(@ActiveOrgId() orgId: string, @Body() dto: CreatePromotionDto) {
    return this.promotionsService.create(orgId, dto);
  }

  @Get()
  findAll(
    @ActiveOrgId() orgId: string,
    @Query() query: ListPromotionsQueryDto,
  ) {
    return this.promotionsService.findAll(orgId, query);
  }

  @Get('available')
  available(
    @ActiveOrgId() orgId: string,
    @Query() query: AvailablePromotionsQueryDto,
  ) {
    return this.promotionsService.available(orgId, query.itemIds);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @ActiveOrgId() orgId: string) {
    return this.promotionsService.findOne(id, orgId);
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @ActiveOrgId() orgId: string,
    @Body() dto: UpdatePromotionDto,
  ) {
    return this.promotionsService.update(id, orgId, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @ActiveOrgId() orgId: string) {
    return this.promotionsService.remove(id, orgId);
  }
}
