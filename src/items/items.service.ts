import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateItemDto } from './dto/create-item.dto.js';
import { UpdateItemDto } from './dto/update-item.dto.js';

@Injectable()
export class ItemsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(organizationId: string, dto: CreateItemDto) {
    return this.prisma.item.create({
      data: {
        name: dto.name,
        price: dto.price,
        type: dto.type,
        stock: dto.stock,
        description: dto.description,
        organizationId,
      },
    });
  }

  async findAll(
    organizationId: string, 
    page: number = 1, 
    limit: number = 10,
    filters?: { name?: string; type?: string; price?: number; createdAt?: string }
  ) {
    const skip = (page - 1) * limit;

    const where: any = { organizationId };

    if (filters?.name) {
      where.name = { contains: filters.name, mode: 'insensitive' };
    }
    
    if (filters?.type && filters.type !== 'Ambos' && filters.type !== 'ALL' && filters.type !== '') {
      where.type = filters.type;
    }

    if (filters?.price !== undefined && !isNaN(filters.price)) {
      where.price = filters.price;
    }

    if (filters?.createdAt) {
      // Expecting createdAt to be a valid date string, e.g., YYYY-MM-DD
      const date = new Date(filters.createdAt);
      if (!isNaN(date.getTime())) {
        const startOfDay = new Date(date);
        startOfDay.setUTCHours(0, 0, 0, 0);
        
        const endOfDay = new Date(date);
        endOfDay.setUTCHours(23, 59, 59, 999);

        where.createdAt = {
          gte: startOfDay,
          lte: endOfDay,
        };
      }
    }

    const [data, total_items] = await Promise.all([
      this.prisma.item.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.item.count({
        where,
      }),
    ]);

    const total_pages = Math.ceil(total_items / limit);

    return {
      data,
      meta: {
        page,
        per_page: limit,
        total_items,
        total_pages,
        has_next: page < total_pages,
        has_previous: page > 1,
      },
    };
  }

  async search(organizationId: string, query: string) {
    return this.prisma.item.findMany({
      where: {
        organizationId,
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
        ],
      },
      orderBy: { name: 'asc' },
      take: 10,
    });
  }

  async findOne(id: string, organizationId: string) {
    const item = await this.prisma.item.findFirst({
      where: { id, organizationId },
    });

    if (!item) {
      throw new NotFoundException('Produto não encontrado');
    }

    return item;
  }

  async update(id: string, organizationId: string, dto: UpdateItemDto) {
    await this.findOne(id, organizationId);

    return this.prisma.item.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: string, organizationId: string) {
    await this.findOne(id, organizationId);

    return this.prisma.item.delete({
      where: { id },
    });
  }
}
