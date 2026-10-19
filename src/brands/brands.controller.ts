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
import { BrandsService } from './brands.service.js';
import { CreateBrandDto } from './dto/create-brand.dto.js';
import { ListBrandsQueryDto } from './dto/list-brands-query.dto.js';
import { UpdateBrandDto } from './dto/update-brand.dto.js';

@UseGuards(OrganizationGuard)
@UsePipes(PayloadValidationPipe)
@Controller('brands')
export class BrandsController {
  constructor(private readonly brandsService: BrandsService) {}

  @Post()
  create(@ActiveOrgId() orgId: string, @Body() dto: CreateBrandDto) {
    return this.brandsService.create(orgId, dto);
  }

  @Get()
  findAll(@ActiveOrgId() orgId: string, @Query() query: ListBrandsQueryDto) {
    return this.brandsService.findAll(orgId, query);
  }

  @Get('search')
  search(@ActiveOrgId() orgId: string, @Query('q') query?: string) {
    return this.brandsService.search(
      orgId,
      typeof query === 'string' ? query.trim() : '',
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string, @ActiveOrgId() orgId: string) {
    return this.brandsService.findOne(id, orgId);
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @ActiveOrgId() orgId: string,
    @Body() dto: UpdateBrandDto,
  ) {
    return this.brandsService.update(id, orgId, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @ActiveOrgId() orgId: string) {
    return this.brandsService.remove(id, orgId);
  }
}
