import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { SUPPLIER_NOT_FOUND } from '../../suppliers/suppliers.constants.js';
import {
  EMPLOYEE_NOT_FOUND,
  ENTRY_DIRECTION,
  FINANCIAL_ACCOUNT_NOT_FOUND,
  FINANCIAL_CATEGORY_NOT_FOUND,
  type EntryDirection,
} from '../financial.constants.js';

export type ReferenceDb = Pick<
  Prisma.TransactionClient,
  | 'financialAccount'
  | 'financialCategory'
  | 'supplier'
  | 'supplierBankAccount'
  | 'employee'
  | 'client'
>;

/*
 * Vínculos dos lançamentos: precisam ser da organização da sessão. O inativo não entra num vínculo
 * novo, mas o que o lançamento já tinha (`currentId`) continua aceito ao salvar.
 */

/** Conta do caixa; devolve o nome, para as descrições. */
export async function assertAccount(
  db: ReferenceDb,
  organizationId: string,
  accountId: string,
  currentId: string | null = null,
): Promise<{ id: string; name: string }> {
  const account = await db.financialAccount.findFirst({
    where: { id: accountId, organizationId },
    select: { id: true, name: true, active: true },
  });

  if (!account) {
    throw new NotFoundException(FINANCIAL_ACCOUNT_NOT_FOUND);
  }

  if (!account.active && account.id !== currentId) {
    throw new BadRequestException(
      `A conta ${account.name} está inativa: reative-a no Caixa para usá-la`,
    );
  }

  return { id: account.id, name: account.name };
}

/** Categoria do sentido do lançamento: receita na entrada, despesa na saída. */
export async function assertCategory(
  db: ReferenceDb,
  organizationId: string,
  categoryId: string,
  direction: EntryDirection,
  currentId: string | null = null,
): Promise<void> {
  const category = await db.financialCategory.findFirst({
    where: { id: categoryId, organizationId },
    select: { id: true, name: true, direction: true, active: true },
  });

  if (!category) {
    throw new NotFoundException(FINANCIAL_CATEGORY_NOT_FOUND);
  }

  if (category.direction !== direction) {
    throw new BadRequestException(
      direction === ENTRY_DIRECTION.IN
        ? 'Escolha uma categoria de receita'
        : 'Escolha uma categoria de despesa',
    );
  }

  if (!category.active && category.id !== currentId) {
    throw new BadRequestException(
      `A categoria ${category.name} está inativa: reative-a em Categorias para usá-la`,
    );
  }
}

export async function assertSupplier(
  db: ReferenceDb,
  organizationId: string,
  supplierId: string,
  currentId: string | null = null,
): Promise<void> {
  const supplier = await db.supplier.findFirst({
    where: { id: supplierId, organizationId },
    select: { id: true, name: true, active: true },
  });

  if (!supplier) {
    throw new NotFoundException(SUPPLIER_NOT_FOUND);
  }

  if (!supplier.active && supplier.id !== currentId) {
    throw new BadRequestException(
      `O fornecedor ${supplier.name} está inativo: reative-o em Fornecedores para lançar contas dele`,
    );
  }
}

/** Conta bancária cadastrada no fornecedor da conta a pagar. */
export async function assertSupplierBankAccount(
  db: ReferenceDb,
  supplierId: string,
  bankAccountId: string,
): Promise<void> {
  const bankAccount = await db.supplierBankAccount.findFirst({
    where: { id: bankAccountId, supplierId },
    select: { id: true },
  });

  if (!bankAccount) {
    throw new NotFoundException('Conta bancária do fornecedor não encontrada');
  }
}

export async function assertEmployee(
  db: ReferenceDb,
  organizationId: string,
  employeeId: string,
  currentId: string | null = null,
): Promise<void> {
  const employee = await db.employee.findFirst({
    where: { id: employeeId, organizationId },
    select: { id: true, name: true, active: true },
  });

  if (!employee) {
    throw new NotFoundException(EMPLOYEE_NOT_FOUND);
  }

  if (!employee.active && employee.id !== currentId) {
    throw new BadRequestException(
      `O funcionário ${employee.name} está inativo: reative-o em Funcionários para lançar pagamentos dele`,
    );
  }
}

/** Pagamento e recebimento já aconteceram: o dia (YYYY-MM-DD) vai até hoje. */
export function assertNotFuture(day: string, today: string, message: string) {
  if (day > today) throw new BadRequestException(message);
}

/** Cliente do recebimento manual; o excluído só fica nos que já o tinham. */
export async function assertClient(
  db: ReferenceDb,
  organizationId: string,
  clientId: string,
  currentId: string | null = null,
): Promise<void> {
  const client = await db.client.findFirst({
    where: {
      id: clientId,
      organizationId,
      ...(clientId === currentId ? {} : { deletedAt: null }),
    },
    select: { id: true },
  });

  if (!client) {
    throw new NotFoundException('Cliente não encontrado');
  }
}
