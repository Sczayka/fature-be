import { Controller, Get, Query, UseGuards, UsePipes } from '@nestjs/common';
import { ActiveOrgId } from '../auth/decorators.js';
import { OrganizationGuard } from '../auth/organization.guard.js';
import { PayloadValidationPipe } from '../common/pipes/payload-validation.pipe.js';
import { DEFAULT_RECEIPTS_PERIOD } from './dashboard.constants.js';
import { DashboardService } from './dashboard.service.js';
import { DashboardReceiptsQueryDto } from './dto/dashboard-receipts-query.dto.js';

/** Tela inicial: os números das cobranças num relance. */
@UseGuards(OrganizationGuard)
@UsePipes(PayloadValidationPipe)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  /** Indicadores, listas curtas e orçamentos. */
  @Get('summary')
  summary(@ActiveOrgId() orgId: string) {
    return this.dashboardService.summary(orgId);
  }

  /** Recebimentos das faturas por período e por forma de pagamento. */
  @Get('receipts')
  receipts(
    @ActiveOrgId() orgId: string,
    @Query() query: DashboardReceiptsQueryDto,
  ) {
    return this.dashboardService.receipts(
      orgId,
      query.period ?? DEFAULT_RECEIPTS_PERIOD,
    );
  }
}
