import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { formatBRL, formatDateBR } from '../../common/utils/format.js';
import { ChargesService } from '../../payments/charges.service.js';
import {
  MANUAL_PAYMENT_CONFIG_SELECT,
  isManualMethodAvailable,
  lockedMethodMessage,
} from '../../payments/manual/manual-payment-config.js';
import type { PaymentMethod } from '../../payments/payments.constants.js';
import { lockedMethod } from '../../payments/transactions/invoice-balance.js';
import {
  type AppliedBalance,
  InvoiceTransactionsService,
} from '../../payments/transactions/invoice-transactions.service.js';
import {
  BALANCE_TRANSACTION_SELECT,
  TRANSACTION_SOURCE,
  TRANSACTION_STATUS,
  TRANSACTION_TYPE,
} from '../../payments/transactions/transactions.constants.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  type UploadedProof,
  proofFields,
  proofObjectKey,
} from '../../storage/proof-file.js';
import { StorageService } from '../../storage/storage.service.js';
import {
  INVOICE_PAID_EVENT,
  INVOICE_PARTIALLY_PAID_EVENT,
  PAYMENT_PROOF_REJECTED_EVENT,
  type InvoiceTransactionEvent,
} from '../invoice-events.js';
import { INVOICE_STATUS } from '../invoices.constants.js';
import { InvoicesService } from '../invoices.service.js';
import { todayInBillingTimezone, utcMidnight } from '../pricing/dates.js';
import { ConfirmInvoiceTransactionDto } from './dto/confirm-invoice-transaction.dto.js';
import { CreateInvoiceTransactionDto } from './dto/create-invoice-transaction.dto.js';

/** Código em `details` do aviso de comprovante repetido: o fature-fe pede a confirmação. */
export const DUPLICATE_PAYMENT_PROOF = 'DUPLICATE_PAYMENT_PROOF';

/** Situações em que a fatura ainda aceita pagamento. */
const PAYABLE_STATUSES: string[] = [
  INVOICE_STATUS.PENDING,
  INVOICE_STATUS.OVERDUE,
  INVOICE_STATUS.AWAITING_CONFIRMATION,
];

/** O que os lançamentos conferem na fatura: situação, formas, liberações e transações. */
const OPERATOR_INVOICE_SELECT = {
  status: true,
  excessValue: true,
  paymentMethods: true,
  createdAt: true,
  organization: { select: MANUAL_PAYMENT_CONFIG_SELECT },
  transactions: { select: BALANCE_TRANSACTION_SELECT },
} satisfies Prisma.InvoiceSelect;

type OperatorInvoice = Prisma.InvoiceGetPayload<{
  select: typeof OPERATOR_INVOICE_SELECT;
}>;

type TransactionDb = Pick<Prisma.TransactionClient, 'invoiceTransaction'>;

interface ProofReuse {
  organizationId: string;
  transactionId: string;
  bankReference: string | null;
  proofSha256: string | null;
  acknowledgeDuplicates: boolean;
}

/**
 * Lançamentos da empresa nas movimentações da fatura: pagamento recebido por fora, devolução com
 * comprovante, conferência do comprovante do pagador e cancelamento.
 */
@Injectable()
export class InvoiceTransactionActionsService {
  private readonly logger = new Logger(InvoiceTransactionActionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly charges: ChargesService,
    private readonly transactions: InvoiceTransactionsService,
    private readonly storage: StorageService,
    private readonly invoices: InvoicesService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Registra uma transação confirmada com o comprovante. O arquivo vai para o armazenamento antes
   * da gravação (a chave usa o id da transação) e é apagado se a gravação falhar.
   */
  async createByOperator(
    organizationId: string,
    invoiceId: string,
    userId: string,
    dto: CreateInvoiceTransactionDto,
    file: UploadedProof,
  ) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, organizationId },
      select: OPERATOR_INVOICE_SELECT,
    });

    if (!invoice) {
      throw new NotFoundException('Fatura não encontrada');
    }

    this.assertOccurredAt(dto.occurredAt, invoice.createdAt);

    const id = randomUUID();
    const key = proofObjectKey(organizationId, invoiceId, id, file.mimetype);
    const proof = proofFields(file, key);
    const isPayment = dto.type === TRANSACTION_TYPE.PAYMENT;
    const reuse: ProofReuse = {
      organizationId,
      transactionId: id,
      bankReference: dto.bankReference ?? null,
      proofSha256: proof.proofSha256,
      acknowledgeDuplicates: dto.acknowledgeDuplicates ?? false,
    };

    // Antes do upload, para não subir arquivo à toa; de novo dentro do lock
    if (isPayment) {
      this.assertPaymentAccepted(invoice, dto.method);
      await this.assertNoDuplicateProof(this.prisma, reuse);
    }

    await this.storage.put(key, file.buffer, file.mimetype);

    let applied: AppliedBalance;

    try {
      applied = await this.charges.withInvoiceLock(invoiceId, async (tx) => {
        const current = await tx.invoice.findUniqueOrThrow({
          where: { id: invoiceId },
          select: OPERATOR_INVOICE_SELECT,
        });

        if (isPayment) {
          this.assertPaymentAccepted(current, dto.method);
          await this.assertNoDuplicateProof(tx, reuse);
        } else {
          this.assertRefundable(current, dto.amount);
        }

        await tx.invoiceTransaction.create({
          data: {
            id,
            invoiceId,
            type: dto.type,
            method: dto.method,
            amount: dto.amount,
            occurredAt: utcMidnight(dto.occurredAt),
            status: TRANSACTION_STATUS.CONFIRMED,
            source: TRANSACTION_SOURCE.OPERATOR,
            bankReference: dto.bankReference ?? null,
            notes: dto.notes ?? null,
            createdById: userId,
            reviewedById: userId,
            reviewedAt: new Date(),
            ...proof,
          },
        });

        return isPayment
          ? this.applyPayment(tx, invoiceId)
          : this.transactions.applyBalance(tx, invoiceId);
      });
    } catch (error) {
      await this.storage
        .delete(key)
        .catch((deleteError: unknown) =>
          this.logger.error(
            `Comprovante ${key} não apagado após falha no registro da transação`,
            deleteError,
          ),
        );

      throw error;
    }

    // Depois do commit: se a transação falhar, os e-mails não saem
    if (isPayment) {
      this.emitPaymentEvents(applied, {
        invoiceId,
        organizationId,
        transactionId: id,
      });
    } else if (applied.paidEvent) {
      this.eventEmitter.emit(INVOICE_PAID_EVENT, applied.paidEvent);
    }

    return this.invoices.findOne(invoiceId, organizationId);
  }

  /**
   * Conferência do comprovante enviado pelo pagador: o operador informa quanto entrou e quando
   * (a data vale para o desconto e a multa).
   */
  async confirm(
    organizationId: string,
    invoiceId: string,
    transactionId: string,
    userId: string,
    dto: ConfirmInvoiceTransactionDto,
  ) {
    const applied = await this.charges.withInvoiceLock(
      invoiceId,
      async (tx) => {
        const transaction = await this.findAwaitingReview(
          tx,
          organizationId,
          invoiceId,
          transactionId,
        );

        this.assertOccurredAt(dto.occurredAt, transaction.invoice.createdAt);
        await this.assertNoDuplicateProof(tx, {
          organizationId,
          transactionId,
          bankReference: dto.bankReference ?? null,
          proofSha256: transaction.proofSha256,
          acknowledgeDuplicates: dto.acknowledgeDuplicates ?? false,
        });

        await tx.invoiceTransaction.update({
          where: { id: transaction.id },
          data: {
            status: TRANSACTION_STATUS.CONFIRMED,
            amount: dto.amount,
            occurredAt: utcMidnight(dto.occurredAt),
            bankReference: dto.bankReference ?? null,
            notes: dto.notes ?? null,
            reviewedById: userId,
            reviewedAt: new Date(),
          },
        });

        return this.applyPayment(tx, invoiceId);
      },
    );

    this.emitPaymentEvents(applied, {
      invoiceId,
      organizationId,
      transactionId,
    });

    return this.invoices.findOne(invoiceId, organizationId);
  }

  /** Recusa do comprovante: o motivo aparece para o pagador, que pode enviar outro. */
  async reject(
    organizationId: string,
    invoiceId: string,
    transactionId: string,
    userId: string,
    reason: string,
  ) {
    await this.charges.withInvoiceLock(invoiceId, async (tx) => {
      const transaction = await this.findAwaitingReview(
        tx,
        organizationId,
        invoiceId,
        transactionId,
      );

      await tx.invoiceTransaction.update({
        where: { id: transaction.id },
        data: {
          status: TRANSACTION_STATUS.REJECTED,
          statusReason: reason,
          reviewedById: userId,
          reviewedAt: new Date(),
        },
      });

      await this.transactions.applyBalance(tx, invoiceId);
    });

    this.eventEmitter.emit(PAYMENT_PROOF_REJECTED_EVENT, {
      invoiceId,
      organizationId,
      transactionId,
    } satisfies InvoiceTransactionEvent);

    return this.invoices.findOne(invoiceId, organizationId);
  }

  /**
   * Transação confirmada não é editada: é cancelada com o motivo, e o operador lança outra. O
   * comprovante continua no armazenamento, como parte do histórico.
   */
  async cancel(
    organizationId: string,
    invoiceId: string,
    transactionId: string,
    userId: string,
    reason: string,
  ) {
    const paidEvent = await this.charges.withInvoiceLock(
      invoiceId,
      async (tx) => {
        const transaction = await tx.invoiceTransaction.findFirst({
          where: { id: transactionId, invoiceId, invoice: { organizationId } },
          select: { id: true, source: true, status: true },
        });

        if (!transaction) {
          throw new NotFoundException('Transação não encontrada');
        }

        if (transaction.source === TRANSACTION_SOURCE.GATEWAY) {
          throw new ConflictException(
            'Transações do provedor não podem ser canceladas.',
          );
        }

        if (transaction.status !== TRANSACTION_STATUS.CONFIRMED) {
          throw new ConflictException(
            'Só transações confirmadas podem ser canceladas.',
          );
        }

        await tx.invoiceTransaction.update({
          where: { id: transaction.id },
          data: {
            status: TRANSACTION_STATUS.CANCELLED,
            statusReason: reason,
            cancelledById: userId,
            cancelledAt: new Date(),
          },
        });

        return (await this.transactions.applyBalance(tx, invoiceId)).paidEvent;
      },
    );

    if (paidEvent) this.eventEmitter.emit(INVOICE_PAID_EVENT, paidEvent);

    return this.invoices.findOne(invoiceId, organizationId);
  }

  /** URL assinada e temporária do comprovante. */
  async proofUrl(
    organizationId: string,
    invoiceId: string,
    transactionId: string,
  ): Promise<string> {
    const transaction = await this.prisma.invoiceTransaction.findFirst({
      where: { id: transactionId, invoiceId, invoice: { organizationId } },
      select: { proofKey: true, proofMimeType: true, proofName: true },
    });

    if (!transaction?.proofKey) {
      throw new NotFoundException('Comprovante não encontrado');
    }

    return this.storage.getSignedUrl(transaction.proofKey, {
      contentType: transaction.proofMimeType ?? 'application/octet-stream',
      fileName: transaction.proofName ?? 'comprovante',
    });
  }

  /** Recalcula a fatura; quitada, os boletos abertos no provedor são cancelados. */
  private async applyPayment(
    tx: Prisma.TransactionClient,
    invoiceId: string,
  ): Promise<AppliedBalance> {
    const applied = await this.transactions.applyBalance(tx, invoiceId);

    if (applied.status === INVOICE_STATUS.PAID) {
      await this.charges.cancelOpenCharges(tx, invoiceId, null);
    }

    return applied;
  }

  /**
   * Depois do commit: quitada, sai o e-mail de pagamento; sobrou saldo e não há outro comprovante a
   * conferir, sai o de pagamento parcial.
   */
  private emitPaymentEvents(
    applied: AppliedBalance,
    event: InvoiceTransactionEvent,
  ): void {
    if (applied.paidEvent) {
      this.eventEmitter.emit(INVOICE_PAID_EVENT, applied.paidEvent);
      return;
    }

    if (
      applied.status === INVOICE_STATUS.PENDING ||
      applied.status === INVOICE_STATUS.OVERDUE
    ) {
      this.eventEmitter.emit(INVOICE_PARTIALLY_PAID_EVENT, event);
    }
  }

  /** Comprovante do pagador da fatura, ainda não conferido. */
  private async findAwaitingReview(
    tx: Prisma.TransactionClient,
    organizationId: string,
    invoiceId: string,
    transactionId: string,
  ) {
    const transaction = await tx.invoiceTransaction.findFirst({
      where: { id: transactionId, invoiceId, invoice: { organizationId } },
      select: {
        id: true,
        status: true,
        proofSha256: true,
        invoice: { select: { createdAt: true } },
      },
    });

    if (!transaction) {
      throw new NotFoundException('Transação não encontrada');
    }

    if (transaction.status !== TRANSACTION_STATUS.PENDING_REVIEW) {
      throw new ConflictException('Este comprovante já foi conferido.');
    }

    return transaction;
  }

  /** Pagamento manual lançado pela empresa: as mesmas regras do comprovante do pagador. */
  private assertPaymentAccepted(
    invoice: OperatorInvoice,
    method: PaymentMethod,
  ): void {
    if (!PAYABLE_STATUSES.includes(invoice.status)) {
      throw new ConflictException('Esta fatura não aceita pagamento.');
    }

    if (
      !invoice.paymentMethods.includes(method) ||
      !isManualMethodAvailable(invoice.organization, method)
    ) {
      throw new BadRequestException(
        'Forma de pagamento não habilitada nesta fatura',
      );
    }

    const locked = lockedMethod(invoice.transactions);

    if (locked && locked !== method) {
      throw new ConflictException(lockedMethodMessage(locked));
    }
  }

  /**
   * Comprovante (ou referência bancária) de outro pagamento confirmado da organização: é um aviso,
   * não um bloqueio, porque uma transferência pode pagar duas faturas. O operador confirma de novo
   * com `acknowledgeDuplicates`.
   */
  private async assertNoDuplicateProof(
    db: TransactionDb,
    reuse: ProofReuse,
  ): Promise<void> {
    const matches: Prisma.InvoiceTransactionWhereInput[] = [
      ...(reuse.bankReference ? [{ bankReference: reuse.bankReference }] : []),
      ...(reuse.proofSha256 ? [{ proofSha256: reuse.proofSha256 }] : []),
    ];

    if (reuse.acknowledgeDuplicates || matches.length === 0) return;

    const duplicate = await db.invoiceTransaction.findFirst({
      where: {
        id: { not: reuse.transactionId },
        status: TRANSACTION_STATUS.CONFIRMED,
        invoice: { organizationId: reuse.organizationId },
        OR: matches,
      },
      select: {
        invoice: {
          select: {
            id: true,
            dueDate: true,
            client: { select: { name: true } },
          },
        },
      },
    });

    if (!duplicate) return;

    const { client, dueDate } = duplicate.invoice;

    throw new ConflictException({
      message: `Este comprovante já foi usado na fatura de ${client.name} com vencimento em ${formatDateBR(dueDate.toISOString())}. Confirme de novo se a mesma transferência pagou as duas faturas.`,
      details: [DUPLICATE_PAYMENT_PROOF],
    });
  }

  /** A data vai da emissão da fatura até hoje, no fuso de cobrança. */
  private assertOccurredAt(occurredAt: string, invoiceCreatedAt: Date) {
    if (occurredAt > todayInBillingTimezone()) {
      throw new BadRequestException('A data não pode ser futura.');
    }

    if (occurredAt < todayInBillingTimezone(invoiceCreatedAt)) {
      throw new BadRequestException(
        'A data não pode ser anterior à emissão da fatura.',
      );
    }
  }

  /** Devolução só em fatura paga e até o excedente ainda não devolvido. */
  private assertRefundable(
    invoice: { status: string; excessValue: number },
    amount: number,
  ) {
    if (invoice.status !== INVOICE_STATUS.PAID) {
      throw new ConflictException(
        'Só dá para registrar devolução em fatura paga.',
      );
    }

    if (new Prisma.Decimal(amount).gt(invoice.excessValue)) {
      throw new UnprocessableEntityException(
        `A devolução não pode passar do excedente de ${formatBRL(invoice.excessValue)}.`,
      );
    }
  }
}
