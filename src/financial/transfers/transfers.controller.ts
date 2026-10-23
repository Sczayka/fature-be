import {
  Body,
  Controller,
  Delete,
  Param,
  Post,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { ActiveOrgId, CurrentUser } from '../../auth/decorators.js';
import { OrganizationGuard } from '../../auth/organization.guard.js';
import { PayloadValidationPipe } from '../../common/pipes/payload-validation.pipe.js';
import { CreateTransferDto } from './dto/create-transfer.dto.js';
import { TransfersService } from './transfers.service.js';

/** Transferências entre as contas do caixa (aparecem no extrato das duas). */
@UseGuards(OrganizationGuard)
@UsePipes(PayloadValidationPipe)
@Controller('financial/transfers')
export class TransfersController {
  constructor(private readonly transfersService: TransfersService) {}

  @Post()
  create(
    @ActiveOrgId() orgId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateTransferDto,
  ) {
    return this.transfersService.create(orgId, userId, dto);
  }

  @Delete(':transferId')
  remove(
    @Param('transferId') transferId: string,
    @ActiveOrgId() orgId: string,
  ) {
    return this.transfersService.remove(transferId, orgId);
  }
}
