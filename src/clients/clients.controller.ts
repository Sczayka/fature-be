import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  UsePipes,
  Query,
} from '@nestjs/common';
import { ClientsService } from './clients.service.js';
import { CreateClientDto } from './dto/create-client.dto.js';
import { ListClientsQueryDto } from './dto/list-clients-query.dto.js';
import { UpdateClientDto } from './dto/update-client.dto.js';
import { OrganizationGuard } from '../auth/organization.guard.js';
import { ActiveOrgId } from '../auth/decorators.js';
import { PayloadValidationPipe } from '../common/pipes/payload-validation.pipe.js';

@UseGuards(OrganizationGuard)
@UsePipes(PayloadValidationPipe)
@Controller('clients')
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @Post()
  create(@ActiveOrgId() orgId: string, @Body() dto: CreateClientDto) {
    return this.clientsService.create(orgId, dto);
  }

  @Get()
  findAll(@ActiveOrgId() orgId: string, @Query() query: ListClientsQueryDto) {
    return this.clientsService.findAll(orgId, query);
  }

  @Get('search')
  search(@ActiveOrgId() orgId: string, @Query('q') query: string) {
    if (!query || query.trim().length === 0) {
      return [];
    }
    return this.clientsService.search(orgId, query.trim());
  }

  @Get(':id')
  findOne(@Param('id') id: string, @ActiveOrgId() orgId: string) {
    return this.clientsService.findOne(id, orgId);
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @ActiveOrgId() orgId: string,
    @Body() dto: UpdateClientDto,
  ) {
    return this.clientsService.update(id, orgId, dto);
  }

  /** Exclusão lógica: as faturas, os orçamentos e os e-mails do cliente continuam no histórico. */
  @Delete(':id')
  remove(@Param('id') id: string, @ActiveOrgId() orgId: string) {
    return this.clientsService.remove(id, orgId);
  }
}
