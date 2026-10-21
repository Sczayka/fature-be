import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ActiveOrgId } from '../../auth/decorators.js';
import { OrganizationGuard } from '../../auth/organization.guard.js';
import { EmailLogsService } from './email-logs.service.js';

const MAX_LIMIT = 100;

function toPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = value ? parseInt(value, 10) : NaN;

  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

@UseGuards(OrganizationGuard)
@Controller('email-logs')
export class EmailLogsController {
  constructor(private readonly emailLogs: EmailLogsService) {}

  @Get()
  findAll(
    @ActiveOrgId() orgId: string,
    @Query('clientId') clientId?: string,
    @Query('invoiceId') invoiceId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.emailLogs.findAll(orgId, {
      clientId: clientId || null,
      invoiceId: invoiceId || null,
      page: toPositiveInt(page, 1),
      limit: Math.min(toPositiveInt(limit, 10), MAX_LIMIT),
    });
  }
}
