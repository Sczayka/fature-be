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
import { CreateEmployeeDto } from './dto/create-employee.dto.js';
import { ListEmployeesQueryDto } from './dto/list-employees-query.dto.js';
import { UpdateEmployeeDto } from './dto/update-employee.dto.js';
import { EmployeesService } from './employees.service.js';

/** Funcionários da folha de pagamento. */
@UseGuards(OrganizationGuard)
@UsePipes(PayloadValidationPipe)
@Controller('financial/employees')
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

  @Post()
  create(@ActiveOrgId() orgId: string, @Body() dto: CreateEmployeeDto) {
    return this.employeesService.create(orgId, dto);
  }

  @Get()
  findAll(@ActiveOrgId() orgId: string, @Query() query: ListEmployeesQueryDto) {
    return this.employeesService.findAll(orgId, query);
  }

  /** Só os ativos, até 10 (antes de `:id`). */
  @Get('search')
  search(@ActiveOrgId() orgId: string, @Query('q') query?: string) {
    return this.employeesService.search(
      orgId,
      typeof query === 'string' ? query.trim() : '',
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string, @ActiveOrgId() orgId: string) {
    return this.employeesService.findOne(id, orgId);
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @ActiveOrgId() orgId: string,
    @Body() dto: UpdateEmployeeDto,
  ) {
    return this.employeesService.update(id, orgId, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @ActiveOrgId() orgId: string) {
    return this.employeesService.remove(id, orgId);
  }
}
