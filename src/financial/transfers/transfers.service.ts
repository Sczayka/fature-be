import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  todayInBillingTimezone,
  utcMidnight,
} from '../../invoices/pricing/dates.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { assertAccount, assertNotFuture } from '../entries/entry-references.js';
import { toEntryResponse } from '../entries/entry-response.js';
import {
  ENTRY_DIRECTION,
  ENTRY_ORIGIN,
  ENTRY_STATUS,
  FINANCIAL_ENTRY_SELECT,
} from '../financial.constants.js';
import { CreateTransferDto } from './dto/create-transfer.dto.js';

/**
 * Transferência entre contas do caixa: uma saída na origem e uma entrada no destino, com o mesmo
 * transferId. Não é receita nem despesa: não aparece nos recebimentos nem nas contas a pagar.
 * Para corrigir, exclua e lance de novo.
 */
@Injectable()
export class TransfersService {
  constructor(private readonly prisma: PrismaService) {}

  /** Devolve a saída e a entrada. */
  async create(organizationId: string, userId: string, dto: CreateTransferDto) {
    const today = todayInBillingTimezone();

    if (dto.fromAccountId === dto.toAccountId) {
      throw new BadRequestException(
        'Escolha contas diferentes para a origem e o destino',
      );
    }

    assertNotFuture(
      dto.date,
      today,
      'A data da transferência não pode ser futura',
    );

    const [from, to] = await Promise.all([
      assertAccount(this.prisma, organizationId, dto.fromAccountId),
      assertAccount(this.prisma, organizationId, dto.toAccountId),
    ]);
    const transferId = randomUUID();
    const date = utcMidnight(dto.date);

    // Uma gravação por vez e só o id: a conexão da transação não aceita consultas simultâneas, e
    // o Prisma busca as relações do select em paralelo
    await this.prisma.$transaction(async (tx) => {
      const leg = (direction: string, accountId: string, description: string) =>
        tx.financialEntry.create({
          data: {
            organizationId,
            direction,
            origin: ENTRY_ORIGIN.TRANSFER,
            status: ENTRY_STATUS.PAID,
            description,
            amount: dto.amount,
            paidAmount: dto.amount,
            paymentDate: date,
            settlementDate: date,
            accountId,
            notes: dto.notes ?? null,
            transferId,
            createdById: userId,
          },
          select: { id: true },
        });

      await leg(
        ENTRY_DIRECTION.OUT,
        from.id,
        dto.description ?? `Transferência para ${to.name}`,
      );
      await leg(
        ENTRY_DIRECTION.IN,
        to.id,
        dto.description ?? `Transferência de ${from.name}`,
      );
    });

    // A saída primeiro
    const legs = await this.prisma.financialEntry.findMany({
      where: { transferId },
      select: FINANCIAL_ENTRY_SELECT,
      orderBy: { direction: 'desc' },
    });

    return legs.map((entry) => toEntryResponse(entry, today));
  }

  /** Exclui as duas pontas. */
  async remove(transferId: string, organizationId: string) {
    const { count } = await this.prisma.financialEntry.deleteMany({
      where: { transferId, organizationId, origin: ENTRY_ORIGIN.TRANSFER },
    });

    if (count === 0) {
      throw new NotFoundException('Transferência não encontrada');
    }

    return { count };
  }
}
