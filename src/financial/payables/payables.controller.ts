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
import { ActiveOrgId, CurrentUser } from '../../auth/decorators.js';
import { OrganizationGuard } from '../../auth/organization.guard.js';
import { PayloadValidationPipe } from '../../common/pipes/payload-validation.pipe.js';
import { CreatePayableDto } from './dto/create-payable.dto.js';
import { DeletePayableQueryDto } from './dto/delete-payable-query.dto.js';
import { ListPayablesQueryDto } from './dto/list-payables-query.dto.js';
import { PayPayableDto } from './dto/pay-payable.dto.js';
import { UpdatePayableDto } from './dto/update-payable.dto.js';
import { PayablesService } from './payables.service.js';

/** Contas a pagar: de fornecedores, da folha e avulsas, com a baixa. */
@UseGuards(OrganizationGuard)
@UsePipes(PayloadValidationPipe)
@Controller('financial/payables')
export class PayablesController {
  constructor(private readonly payablesService: PayablesService) {}

  @Get()
  findAll(@ActiveOrgId() orgId: string, @Query() query: ListPayablesQueryDto) {
    return this.payablesService.findAll(orgId, query);
  }

  /** Vencidas, a vencer e pagas no mês (antes de `:id`). */
  @Get('totals')
  totals(@ActiveOrgId() orgId: string) {
    return this.payablesService.totals(orgId);
  }

  /** Contas vencidas, para o número no menu (antes de `:id`). */
  @Get('overdue/count')
  overdueCount(@ActiveOrgId() orgId: string) {
    return this.payablesService.overdueCount(orgId);
  }

  /** Uma conta, as parcelas ou a recorrência; a conta única pode vir já paga. */
  @Post()
  create(
    @ActiveOrgId() orgId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreatePayableDto,
  ) {
    return this.payablesService.create(orgId, userId, dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @ActiveOrgId() orgId: string) {
    return this.payablesService.findOne(id, orgId);
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @ActiveOrgId() orgId: string,
    @Body() dto: UpdatePayableDto,
  ) {
    return this.payablesService.update(id, orgId, dto);
  }

  /** `?scope=FOLLOWING` exclui também as próximas da série em aberto. */
  @Delete(':id')
  remove(
    @Param('id') id: string,
    @ActiveOrgId() orgId: string,
    @Query() query: DeletePayableQueryDto,
  ) {
    return this.payablesService.remove(id, orgId, query.scope);
  }

  @Post(':id/pay')
  pay(
    @Param('id') id: string,
    @ActiveOrgId() orgId: string,
    @Body() dto: PayPayableDto,
  ) {
    return this.payablesService.pay(id, orgId, dto);
  }

  @Post(':id/reopen')
  reopen(@Param('id') id: string, @ActiveOrgId() orgId: string) {
    return this.payablesService.reopen(id, orgId);
  }
}
