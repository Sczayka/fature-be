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
import { CreateFinancialAccountDto } from './dto/create-financial-account.dto.js';
import { ListFinancialAccountsQueryDto } from './dto/list-financial-accounts-query.dto.js';
import { StatementQueryDto } from './dto/statement-query.dto.js';
import { UpdateFinancialAccountDto } from './dto/update-financial-account.dto.js';
import { FinancialAccountsService } from './financial-accounts.service.js';

/** Caixa: as contas, o saldo e o extrato de cada uma. */
@UseGuards(OrganizationGuard)
@UsePipes(PayloadValidationPipe)
@Controller('financial/accounts')
export class FinancialAccountsController {
  constructor(private readonly accountsService: FinancialAccountsService) {}

  @Get()
  findAll(
    @ActiveOrgId() orgId: string,
    @Query() query: ListFinancialAccountsQueryDto,
  ) {
    return this.accountsService.findAll(orgId, query);
  }

  @Post()
  create(@ActiveOrgId() orgId: string, @Body() dto: CreateFinancialAccountDto) {
    return this.accountsService.create(orgId, dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @ActiveOrgId() orgId: string) {
    return this.accountsService.findOne(id, orgId);
  }

  @Get(':id/statement')
  statement(
    @Param('id') id: string,
    @ActiveOrgId() orgId: string,
    @Query() query: StatementQueryDto,
  ) {
    return this.accountsService.statement(id, orgId, query);
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @ActiveOrgId() orgId: string,
    @Body() dto: UpdateFinancialAccountDto,
  ) {
    return this.accountsService.update(id, orgId, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @ActiveOrgId() orgId: string) {
    return this.accountsService.remove(id, orgId);
  }
}
