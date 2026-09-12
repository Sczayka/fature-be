import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { UpdateCompanyInfoDto } from './dto/update-company-info.dto.js';

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  async updateCompanyInfo(id: string, updateCompanyInfoDto: UpdateCompanyInfoDto) {
    if (!id) {
      throw new BadRequestException('ID da organização não fornecido.');
    }

    // Atualiza os dados da empresa e endereço no banco de dados
    const updatedOrg = await this.prisma.organization.update({
      where: { id },
      data: updateCompanyInfoDto,
    });

    return updatedOrg;
  }
}
