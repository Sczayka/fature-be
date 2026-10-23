import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { ActiveOrgId, CurrentUser } from '../../auth/decorators.js';
import { OrganizationGuard } from '../../auth/organization.guard.js';
import { PayloadValidationPipe } from '../../common/pipes/payload-validation.pipe.js';
import { GeneratePayrollDto } from './dto/generate-payroll.dto.js';
import { PayrollQueryDto } from './dto/payroll-query.dto.js';
import { PayrollService } from './payroll.service.js';

/**
 * Folha de pagamento do mês. Os pagamentos são contas a pagar com o funcionário: lançados, pagos,
 * editados e excluídos por /financial/payables.
 */
@UseGuards(OrganizationGuard)
@UsePipes(PayloadValidationPipe)
@Controller('financial/payroll')
export class PayrollController {
  constructor(private readonly payrollService: PayrollService) {}

  @Get()
  findMonth(@ActiveOrgId() orgId: string, @Query() query: PayrollQueryDto) {
    return this.payrollService.findMonth(orgId, query);
  }

  /** Os salários do mês para os funcionários ativos que ainda não têm. */
  @Post('generate')
  generate(
    @ActiveOrgId() orgId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: GeneratePayrollDto,
  ) {
    return this.payrollService.generate(orgId, userId, dto);
  }
}
