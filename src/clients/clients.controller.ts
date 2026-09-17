import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  Query,
} from '@nestjs/common';
import { ClientsService } from './clients.service.js';
import { CreateClientDto } from './dto/create-client.dto.js';
import { UpdateClientDto } from './dto/update-client.dto.js';
import { OrganizationGuard } from '../auth/organization.guard.js';
import { ActiveOrgId } from '../auth/decorators.js';

@UseGuards(OrganizationGuard)
@Controller('clients')
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @Post()
  create(
    @ActiveOrgId() orgId: string,
    @Body() dto: CreateClientDto,
  ) {
    return this.clientsService.create(orgId, dto);
  }

  @Get()
  findAll(
    @ActiveOrgId() orgId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('name') name?: string,
    @Query('email') email?: string,
    @Query('phone') phone?: string,
    @Query('createdAt') createdAt?: string,
  ) {
    const pageNumber = page ? parseInt(page, 10) : 1;
    const limitNumber = limit ? parseInt(limit, 10) : 10;
    return this.clientsService.findAll(orgId, pageNumber, limitNumber, { name, email, phone, createdAt });
  }

  @Get('search')
  search(
    @ActiveOrgId() orgId: string,
    @Query('q') query: string,
  ) {
    if (!query || query.trim().length === 0) {
      return [];
    }
    return this.clientsService.search(orgId, query.trim());
  }

  @Get(':id')
  findOne(
    @Param('id') id: string,
    @ActiveOrgId() orgId: string,
  ) {
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

  @Delete(':id')
  remove(
    @Param('id') id: string,
    @ActiveOrgId() orgId: string,
  ) {
    return this.clientsService.remove(id, orgId);
  }
}
