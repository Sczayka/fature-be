import { Prisma } from '@prisma/client';
import { roundCurrency } from '../common/utils/currency.js';
import { ENTRY_DIRECTION } from './financial.constants.js';

const ZERO = new Prisma.Decimal(0);

/** Soma por sentido: o groupBy dos lançamentos com `_sum` do pago e da taxa. */
export interface DirectionSum {
  direction: string;
  _sum: {
    paidAmount: Prisma.Decimal | null;
    feeAmount: Prisma.Decimal | null;
  };
}

/** O que o lançamento pago fez na conta. */
export interface Movement {
  direction: string;
  paidAmount: Prisma.Decimal | null;
  feeAmount: Prisma.Decimal;
}

/** Efeito na conta: o líquido (pago menos a taxa), positivo na entrada e negativo na saída. */
export function signedNet(movement: Movement): Prisma.Decimal {
  const net = (movement.paidAmount ?? ZERO).minus(movement.feeAmount);

  return movement.direction === ENTRY_DIRECTION.IN ? net : net.negated();
}

/** Efeito somado dos grupos na conta. */
export function sumMovements(groups: DirectionSum[]): Prisma.Decimal {
  return groups.reduce(
    (total, group) =>
      total.plus(
        signedNet({
          direction: group.direction,
          paidAmount: group._sum.paidAmount,
          feeAmount: group._sum.feeAmount ?? ZERO,
        }),
      ),
    ZERO,
  );
}

/** Entradas e saídas brutas de uma lista de movimentos (o líquido de cada um). */
export function sumByDirection(movements: Movement[]): {
  totalIn: Prisma.Decimal;
  totalOut: Prisma.Decimal;
} {
  return movements.reduce(
    (totals, movement) => {
      const net = signedNet(movement);

      return movement.direction === ENTRY_DIRECTION.IN
        ? { ...totals, totalIn: totals.totalIn.plus(net) }
        : { ...totals, totalOut: totals.totalOut.minus(net) };
    },
    { totalIn: ZERO, totalOut: ZERO },
  );
}

/** Saldo depois de cada movimento, na ordem recebida, a partir de `opening`. */
export function withRunningBalance<T extends Movement>(
  opening: Prisma.Decimal,
  movements: T[],
): { movement: T; balance: Prisma.Decimal }[] {
  let balance = opening;

  return movements.map((movement) => {
    balance = balance.plus(signedNet(movement));

    return { movement, balance };
  });
}

/** Valor da resposta da API: número em 2 casas (o Decimal viraria texto no JSON). */
export function toAmount(value: Prisma.Decimal): number {
  return roundCurrency(value.toNumber());
}

export function toAmountOrNull(value: Prisma.Decimal | null): number | null {
  return value ? toAmount(value) : null;
}
