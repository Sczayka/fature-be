import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { roundCurrency } from '../../common/utils/currency.js';
import {
  daysBetween,
  todayInBillingTimezone,
  utcMidnight,
} from '../../invoices/pricing/dates.js';
import { GATEWAY_ACCOUNT_STATUS } from '../../payments/payments.constants.js';
import { PaymentProviderRegistry } from '../../payments/providers/payment-provider.registry.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { toEntryResponse } from '../entries/entry-response.js';
import {
  sumByDirection,
  sumMovements,
  toAmount,
  withRunningBalance,
} from '../financial-balance.js';
import {
  ENTRY_STATUS,
  FINANCIAL_ACCOUNT_NOT_FOUND,
  FINANCIAL_ENTRY_SELECT,
  STATEMENT_MAX_DAYS,
} from '../financial.constants.js';
import { monthEnd, monthStart, toDateOnly } from '../financial-dates.js';
import { FinancialSetupService } from '../setup/financial-setup.service.js';
import { CreateFinancialAccountDto } from './dto/create-financial-account.dto.js';
import { ListFinancialAccountsQueryDto } from './dto/list-financial-accounts-query.dto.js';
import { StatementQueryDto } from './dto/statement-query.dto.js';
import { UpdateFinancialAccountDto } from './dto/update-financial-account.dto.js';

const ACCOUNT_SELECT = {
  id: true,
  name: true,
  type: true,
  openingBalance: true,
  openingDate: true,
  isMain: true,
  active: true,
  notes: true,
  paymentGatewayAccountId: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.FinancialAccountSelect;

type AccountRow = Prisma.FinancialAccountGetPayload<{
  select: typeof ACCOUNT_SELECT;
}>;

interface AccountBalances {
  /** Saldo de hoje: o inicial mais o que foi pago do dia do saldo inicial até hoje. */
  balance: Prisma.Decimal;
  /** Pago, mas com o crédito do provedor ainda por vir. */
  pendingCredits: Prisma.Decimal;
}

const ZERO = new Prisma.Decimal(0);

const NAME_TAKEN = 'Já existe uma conta com este nome.';

/** A conta do provedor não sai na resposta: a organização não vê o roteamento. */
function toAccountResponse(account: AccountRow, balances: AccountBalances) {
  const { openingBalance, openingDate, paymentGatewayAccountId, ...rest } =
    account;

  return {
    ...rest,
    openingBalance: toAmount(openingBalance),
    openingDate: toDateOnly(openingDate),
    /** Conta do Fature no provedor: criada pelo sistema, recebe os pagamentos das cobranças. */
    isProviderAccount: paymentGatewayAccountId !== null,
    balance: toAmount(balances.balance),
    pendingCredits: toAmount(balances.pendingCredits),
  };
}

/**
 * Contas do caixa e o saldo delas. O saldo não é gravado: é o inicial mais os lançamentos pagos
 * a partir do dia do saldo inicial, pela data em que o dinheiro entrou ou saiu da conta. A conta
 * principal (recebe os pagamentos manuais das faturas) e a do provedor não são excluídas.
 */
@Injectable()
export class FinancialAccountsService {
  private readonly logger = new Logger(FinancialAccountsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly setup: FinancialSetupService,
    private readonly registry: PaymentProviderRegistry,
  ) {}

  /** A principal primeiro, depois por nome, com o saldo de hoje e o que ainda vai ser creditado. */
  async findAll(organizationId: string, query: ListFinancialAccountsQueryDto) {
    await this.setup.ensureSetup(organizationId);

    const accounts = await this.prisma.financialAccount.findMany({
      where: {
        organizationId,
        ...(query.active !== undefined ? { active: query.active } : {}),
      },
      select: ACCOUNT_SELECT,
      orderBy: [{ isMain: 'desc' }, { name: 'asc' }],
    });
    const balances = await this.balances(accounts, todayInBillingTimezone());

    return accounts.map((account) =>
      toAccountResponse(account, balances.get(account.id)!),
    );
  }

  /** Com o saldo informado pelo provedor, na conta dele (null quando indisponível). */
  async findOne(id: string, organizationId: string) {
    const account = await this.findAccount(id, organizationId);
    const [balances, providerBalance] = await Promise.all([
      this.balances([account], todayInBillingTimezone()),
      this.providerBalance(account),
    ]);

    return {
      ...toAccountResponse(account, balances.get(account.id)!),
      providerBalance,
    };
  }

  async create(organizationId: string, dto: CreateFinancialAccountDto) {
    await this.setup.ensureSetup(organizationId);
    await this.assertNameAvailable(organizationId, dto.name);

    const today = todayInBillingTimezone();
    const openingDate = dto.openingDate ?? today;

    assertOpeningDate(openingDate, today);
    assertMainIsActive(dto.isMain ?? false, dto.active ?? true, false);

    const account = await this.prisma.$transaction(async (tx) => {
      if (dto.isMain) await unsetMain(tx, organizationId);

      return tx.financialAccount.create({
        data: {
          organizationId,
          name: dto.name,
          type: dto.type,
          openingBalance: dto.openingBalance ?? 0,
          openingDate: utcMidnight(openingDate),
          isMain: dto.isMain ?? false,
          active: dto.active ?? true,
          notes: dto.notes ?? null,
        },
        select: { id: true },
      });
    });

    return this.findOne(account.id, organizationId);
  }

  /**
   * Campo ausente não muda nada. Marcar outra conta como principal desmarca a atual; a principal
   * não é desmarcada nem inativada sozinha.
   */
  async update(
    id: string,
    organizationId: string,
    dto: UpdateFinancialAccountDto,
  ) {
    const account = await this.findAccount(id, organizationId);

    if (dto.name !== undefined) {
      await this.assertNameAvailable(organizationId, dto.name, id);
    }

    if (
      account.paymentGatewayAccountId &&
      dto.type !== undefined &&
      dto.type !== account.type
    ) {
      throw new BadRequestException(
        'A conta do Fature é sempre do tipo provedor de pagamento',
      );
    }

    if (account.isMain && dto.isMain === false) {
      throw new BadRequestException(
        'Para trocar a conta principal, marque outra conta como principal',
      );
    }

    assertMainIsActive(
      dto.isMain ?? account.isMain,
      dto.active ?? account.active,
      account.isMain,
    );

    if (dto.openingDate !== undefined) {
      assertOpeningDate(dto.openingDate, todayInBillingTimezone());
    }

    await this.prisma.$transaction(async (tx) => {
      if (dto.isMain && !account.isMain) await unsetMain(tx, organizationId);

      await tx.financialAccount.update({
        where: { id },
        data: {
          name: dto.name,
          type: dto.type,
          openingBalance: dto.openingBalance,
          openingDate:
            dto.openingDate !== undefined
              ? utcMidnight(dto.openingDate)
              : undefined,
          isMain: dto.isMain,
          active: dto.active,
          notes: dto.notes,
        },
      });
    });

    return this.findOne(id, organizationId);
  }

  /** Só sem lançamentos; a principal e a do provedor nunca. */
  async remove(id: string, organizationId: string) {
    const account = await this.findAccount(id, organizationId);

    if (account.isMain) {
      throw new ConflictException(
        'A conta principal não pode ser excluída: marque outra conta como principal antes.',
      );
    }

    if (account.paymentGatewayAccountId) {
      throw new ConflictException(
        'A conta do Fature não pode ser excluída: é nela que caem os pagamentos das faturas. Inative-a para escondê-la.',
      );
    }

    const entries = await this.prisma.financialEntry.count({
      where: { accountId: id },
    });

    if (entries > 0) {
      throw new ConflictException(
        `Esta conta tem ${entries === 1 ? '1 lançamento' : `${entries} lançamentos`} e não pode ser excluída. Inative-a para que ela não apareça em novos lançamentos.`,
      );
    }

    await this.prisma.financialAccount.delete({ where: { id } });

    return toAccountResponse(account, {
      balance: account.openingBalance,
      pendingCredits: ZERO,
    });
  }

  /**
   * Extrato do período (sem as datas, o mês atual): o saldo do começo, cada lançamento pago com o
   * saldo depois dele e o saldo do fim. O período começa no dia do saldo inicial quando é anterior
   * a ele. Créditos do provedor com data futura aparecem como previstos.
   */
  async statement(
    id: string,
    organizationId: string,
    query: StatementQueryDto,
  ) {
    const account = await this.findAccount(id, organizationId);
    const today = todayInBillingTimezone();
    const from = query.from ?? monthStart(today);
    const to = query.to ?? monthEnd(today);

    if (from > to) {
      throw new BadRequestException(
        'O início do período deve ser antes do fim',
      );
    }

    if (daysBetween(from, to) >= STATEMENT_MAX_DAYS) {
      throw new BadRequestException(
        `O extrato vai até ${STATEMENT_MAX_DAYS} dias: escolha um período menor`,
      );
    }

    const openingDay = toDateOnly(account.openingDate);
    const start = from > openingDay ? from : openingDay;

    const [before, rows, balances] = await Promise.all([
      // O que foi pago entre o dia do saldo inicial e a véspera do período
      start > openingDay
        ? this.prisma.financialEntry.groupBy({
            by: ['direction'],
            where: {
              accountId: id,
              status: ENTRY_STATUS.PAID,
              settlementDate: {
                gte: account.openingDate,
                lt: utcMidnight(start),
              },
            },
            _sum: { paidAmount: true, feeAmount: true },
          })
        : Promise.resolve([]),
      start <= to
        ? this.prisma.financialEntry.findMany({
            where: {
              accountId: id,
              status: ENTRY_STATUS.PAID,
              settlementDate: { gte: utcMidnight(start), lte: utcMidnight(to) },
            },
            select: FINANCIAL_ENTRY_SELECT,
            orderBy: [
              { settlementDate: 'asc' },
              { createdAt: 'asc' },
              { id: 'asc' },
            ],
          })
        : Promise.resolve([]),
      this.balances([account], today),
    ]);

    const previousBalance = account.openingBalance.plus(sumMovements(before));
    const lines = withRunningBalance(previousBalance, rows);
    const { totalIn, totalOut } = sumByDirection(rows);
    const counterparts = await this.transferCounterparts(rows);

    return {
      account: toAccountResponse(account, balances.get(account.id)!),
      from,
      to,
      previousBalance: toAmount(previousBalance),
      totalIn: toAmount(totalIn),
      totalOut: toAmount(totalOut),
      closingBalance: toAmount(lines.at(-1)?.balance ?? previousBalance),
      lines: lines.map(({ movement, balance }) => ({
        ...toEntryResponse(movement, today),
        balance: toAmount(balance),
        /** O crédito do provedor ainda não caiu. */
        isFuture: toDateOnly(movement.settlementDate!) > today,
        /** Transferência: a outra conta. */
        counterpartAccount: movement.transferId
          ? (counterparts.get(movement.transferId) ?? null)
          : null,
      })),
    };
  }

  private async findAccount(id: string, organizationId: string) {
    const account = await this.prisma.financialAccount.findFirst({
      where: { id, organizationId },
      select: ACCOUNT_SELECT,
    });

    if (!account) {
      throw new NotFoundException(FINANCIAL_ACCOUNT_NOT_FOUND);
    }

    return account;
  }

  /** Nome único na organização, sem diferenciar maiúsculas. */
  private async assertNameAvailable(
    organizationId: string,
    name: string,
    exceptId?: string,
  ) {
    const existing = await this.prisma.financialAccount.findFirst({
      where: {
        organizationId,
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { NOT: { id: exceptId } } : {}),
      },
      select: { id: true },
    });

    if (existing) throw new ConflictException(NAME_TAKEN);
  }

  /** Saldo de hoje e créditos futuros de cada conta, em duas consultas para todas. */
  private async balances(
    accounts: AccountRow[],
    today: string,
  ): Promise<Map<string, AccountBalances>> {
    if (accounts.length === 0) return new Map();

    const endOfToday = utcMidnight(today);
    const sums = { paidAmount: true, feeAmount: true } as const;
    const [settled, upcoming] = await Promise.all([
      this.prisma.financialEntry.groupBy({
        by: ['accountId', 'direction'],
        where: {
          status: ENTRY_STATUS.PAID,
          OR: accounts.map((account) => ({
            accountId: account.id,
            settlementDate: { gte: account.openingDate, lte: endOfToday },
          })),
        },
        _sum: sums,
      }),
      this.prisma.financialEntry.groupBy({
        by: ['accountId', 'direction'],
        where: {
          status: ENTRY_STATUS.PAID,
          accountId: { in: accounts.map((account) => account.id) },
          settlementDate: { gt: endOfToday },
        },
        _sum: sums,
      }),
    ]);

    return new Map(
      accounts.map((account) => [
        account.id,
        {
          balance: account.openingBalance.plus(
            sumMovements(settled.filter((row) => row.accountId === account.id)),
          ),
          pendingCredits: sumMovements(
            upcoming.filter((row) => row.accountId === account.id),
          ),
        },
      ]),
    );
  }

  /** Saldo da conta no provedor, para conferir com o calculado; null sem conta ativa ou na falha. */
  private async providerBalance(account: AccountRow): Promise<number | null> {
    if (!account.paymentGatewayAccountId) return null;

    const gateway = await this.prisma.paymentGatewayAccount.findUnique({
      where: { id: account.paymentGatewayAccountId },
      select: {
        id: true,
        provider: true,
        accountId: true,
        metadata: true,
        status: true,
      },
    });

    if (!gateway || gateway.status !== GATEWAY_ACCOUNT_STATUS.ACTIVE) {
      return null;
    }

    try {
      const balance = await this.registry
        .get(gateway.provider)
        .getBalance(gateway);

      return roundCurrency(balance);
    } catch (error) {
      this.logger.warn(
        `Saldo da conta ${gateway.id} no provedor indisponível`,
        error,
      );

      return null;
    }
  }

  /** A outra conta de cada transferência do extrato. */
  private async transferCounterparts(
    rows: { id: string; transferId: string | null }[],
  ): Promise<Map<string, { id: string; name: string }>> {
    const transferIds = rows.flatMap((row) =>
      row.transferId ? [row.transferId] : [],
    );

    if (transferIds.length === 0) return new Map();

    const others = await this.prisma.financialEntry.findMany({
      where: {
        transferId: { in: transferIds },
        id: { notIn: rows.map((row) => row.id) },
      },
      select: {
        transferId: true,
        account: { select: { id: true, name: true } },
      },
    });

    return new Map(
      others.flatMap((other) =>
        other.transferId && other.account
          ? [[other.transferId, other.account]]
          : [],
      ),
    );
  }
}

function unsetMain(tx: Prisma.TransactionClient, organizationId: string) {
  return tx.financialAccount.updateMany({
    where: { organizationId, isMain: true },
    data: { isMain: false },
  });
}

/** O saldo inicial é de um dia que já começou. */
function assertOpeningDate(openingDate: string, today: string) {
  if (openingDate > today) {
    throw new BadRequestException('O dia do saldo inicial não pode ser futuro');
  }
}

/** A principal recebe os pagamentos manuais das faturas: precisa estar ativa. */
function assertMainIsActive(
  isMain: boolean,
  active: boolean,
  wasMain: boolean,
) {
  if (isMain && !active) {
    throw new BadRequestException(
      wasMain
        ? 'A conta principal não pode ser inativada: marque outra conta como principal antes'
        : 'A conta principal precisa estar ativa',
    );
  }
}
