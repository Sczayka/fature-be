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
import { ActiveOrgId } from '../../auth/decorators.js';
import { OrganizationGuard } from '../../auth/organization.guard.js';
import { PayloadValidationPipe } from '../../common/pipes/payload-validation.pipe.js';
import { CreateFinancialCategoryDto } from './dto/create-financial-category.dto.js';
import { ListFinancialCategoriesQueryDto } from './dto/list-financial-categories-query.dto.js';
import { UpdateFinancialCategoryDto } from './dto/update-financial-category.dto.js';
import { FinancialCategoriesService } from './financial-categories.service.js';

@UseGuards(OrganizationGuard)
@UsePipes(PayloadValidationPipe)
@Controller('financial/categories')
export class FinancialCategoriesController {
  constructor(private readonly categoriesService: FinancialCategoriesService) {}

  @Get()
  findAll(
    @ActiveOrgId() orgId: string,
    @Query() query: ListFinancialCategoriesQueryDto,
  ) {
    return this.categoriesService.findAll(orgId, query);
  }

  @Post()
  create(
    @ActiveOrgId() orgId: string,
    @Body() dto: CreateFinancialCategoryDto,
  ) {
    return this.categoriesService.create(orgId, dto);
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @ActiveOrgId() orgId: string,
    @Body() dto: UpdateFinancialCategoryDto,
  ) {
    return this.categoriesService.update(id, orgId, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @ActiveOrgId() orgId: string) {
    return this.categoriesService.remove(id, orgId);
  }
}
