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
import { CreateSupplierDto } from './dto/create-supplier.dto.js';
import { ListSuppliersQueryDto } from './dto/list-suppliers-query.dto.js';
import { UpdateSupplierDto } from './dto/update-supplier.dto.js';
import { SuppliersService } from './suppliers.service.js';

@UseGuards(OrganizationGuard)
@UsePipes(PayloadValidationPipe)
@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  @Post()
  create(@ActiveOrgId() orgId: string, @Body() dto: CreateSupplierDto) {
    return this.suppliersService.create(orgId, dto);
  }

  @Get()
  findAll(@ActiveOrgId() orgId: string, @Query() query: ListSuppliersQueryDto) {
    return this.suppliersService.findAll(orgId, query);
  }

  /** `brandId` põe primeiro quem fornece a marca escolhida no produto. */
  @Get('search')
  search(
    @ActiveOrgId() orgId: string,
    @Query('q') query?: string,
    @Query('brandId') brandId?: string,
  ) {
    return this.suppliersService.search(
      orgId,
      typeof query === 'string' ? query.trim() : '',
      typeof brandId === 'string' && brandId ? brandId : undefined,
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string, @ActiveOrgId() orgId: string) {
    return this.suppliersService.findOne(id, orgId);
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @ActiveOrgId() orgId: string,
    @Body() dto: UpdateSupplierDto,
  ) {
    return this.suppliersService.update(id, orgId, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @ActiveOrgId() orgId: string) {
    return this.suppliersService.remove(id, orgId);
  }
}
