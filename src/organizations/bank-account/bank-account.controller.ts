import {
  Body,
  Controller,
  Get,
  Put,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { ActiveOrgId } from '../../auth/decorators.js';
import { OrganizationGuard } from '../../auth/organization.guard.js';
import { PayloadValidationPipe } from '../../common/pipes/payload-validation.pipe.js';
import { BankAccountService } from './bank-account.service.js';
import { UpdateBankAccountDto } from './dto/update-bank-account.dto.js';

/** Aba "Dados bancários" das configurações da organização ativa (pagamento manual). */
@UseGuards(OrganizationGuard)
@UsePipes(PayloadValidationPipe)
@Controller('organizations/bank-account')
export class BankAccountController {
  constructor(private readonly bankAccountService: BankAccountService) {}

  @Get()
  get(@ActiveOrgId() orgId: string) {
    return this.bankAccountService.get(orgId);
  }

  @Put()
  update(@ActiveOrgId() orgId: string, @Body() dto: UpdateBankAccountDto) {
    return this.bankAccountService.update(orgId, dto);
  }
}
