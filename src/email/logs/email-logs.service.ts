import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { EMAIL_LOG_SELECT } from '../email.constants.js';

export interface EmailLogFilters {
  clientId: string | null;
  invoiceId: string | null;
  page: number;
  limit: number;
}

/** Registro dos e-mails aos pagadores (aba "E-mails enviados" do cliente), sem o corpo. */
@Injectable()
export class EmailLogsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    organizationId: string,
    { clientId, invoiceId, page, limit }: EmailLogFilters,
  ) {
    const where: Prisma.EmailLogWhereInput = {
      organizationId,
      ...(clientId ? { clientId } : {}),
      ...(invoiceId ? { invoiceId } : {}),
    };
    const [data, total_items] = await Promise.all([
      this.prisma.emailLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: EMAIL_LOG_SELECT,
      }),
      this.prisma.emailLog.count({ where }),
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
}
