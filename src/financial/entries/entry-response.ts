import { toAmount, toAmountOrNull } from '../financial-balance.js';
import {
  ENTRY_STATUS,
  type FinancialEntryRow,
} from '../financial.constants.js';
import {
  toCompetence,
  toDateOnly,
  toDateOnlyOrNull,
} from '../financial-dates.js';

/**
 * Lançamento na resposta da API: valores em número, datas em YYYY-MM-DD, o mês da folha em
 * YYYY-MM e a série agrupada. `netAmount` é o que entrou ou saiu da conta (pago menos a taxa), e
 * `isOverdue`, a conta em aberto com o vencimento passado. `today` no formato YYYY-MM-DD.
 */
export function toEntryResponse(row: FinancialEntryRow, today: string) {
  const {
    amount,
    paidAmount,
    feeAmount,
    dueDate,
    paymentDate,
    settlementDate,
    competence,
    seriesId,
    seriesType,
    seriesIndex,
    seriesSize,
    ...entry
  } = row;

  return {
    ...entry,
    amount: toAmount(amount),
    paidAmount: toAmountOrNull(paidAmount),
    feeAmount: toAmount(feeAmount),
    netAmount:
      row.status === ENTRY_STATUS.PAID && paidAmount
        ? toAmount(paidAmount.minus(feeAmount))
        : null,
    dueDate: toDateOnlyOrNull(dueDate),
    paymentDate: toDateOnlyOrNull(paymentDate),
    settlementDate: toDateOnlyOrNull(settlementDate),
    competence: competence ? toCompetence(competence) : null,
    series:
      seriesId && seriesType && seriesIndex && seriesSize
        ? {
            id: seriesId,
            type: seriesType,
            index: seriesIndex,
            size: seriesSize,
          }
        : null,
    isOverdue:
      row.status === ENTRY_STATUS.PENDING &&
      dueDate !== null &&
      toDateOnly(dueDate) < today,
  };
}

export type EntryResponse = ReturnType<typeof toEntryResponse>;
