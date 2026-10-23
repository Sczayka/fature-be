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
import { CreateReceiptDto } from './dto/create-receipt.dto.js';
import { ListReceiptsQueryDto } from './dto/list-receipts-query.dto.js';
import { UpdateReceiptDto } from './dto/update-receipt.dto.js';
import { ReceiptsService } from './receipts.service.js';

/** Recebimentos: os das faturas, sincronizados, e os lançados pela empresa. */
@UseGuards(OrganizationGuard)
@UsePipes(PayloadValidationPipe)
@Controller('financial/receipts')
export class ReceiptsController {
  constructor(private readonly receiptsService: ReceiptsService) {}

  @Get()
  findAll(@ActiveOrgId() orgId: string, @Query() query: ListReceiptsQueryDto) {
    return this.receiptsService.findAll(orgId, query);
  }

  /** Bruto, taxas, devoluções e líquido do filtro (antes de `:id`). */
  @Get('totals')
  totals(@ActiveOrgId() orgId: string, @Query() query: ListReceiptsQueryDto) {
    return this.receiptsService.totals(orgId, query);
  }

  @Post()
  create(
    @ActiveOrgId() orgId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateReceiptDto,
  ) {
    return this.receiptsService.create(orgId, userId, dto);
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @ActiveOrgId() orgId: string,
    @Body() dto: UpdateReceiptDto,
  ) {
    return this.receiptsService.update(id, orgId, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @ActiveOrgId() orgId: string) {
    return this.receiptsService.remove(id, orgId);
  }
}
