import { roundCurrency } from '../../common/utils/currency.js';

/** Taxa fixa (R$) + percentual. */
export interface Rate {
  fixed: number;
  percent: number;
}

/** Valor (R$) de uma taxa sobre o valor da cobrança. */
export function calcRateAmount(rate: Rate, value: number): number {
  return roundCurrency(rate.fixed + (value * rate.percent) / 100);
}

/**
 * Margem do Fature enviada por split: a taxa negociada com a organização menos o custo
 * negociado com o provedor (que o provedor desconta da conta da organização). Nunca negativa.
 */
export function calcSplitAmount(feeAmount: number, costAmount: number): number {
  return roundCurrency(Math.max(feeAmount - costAmount, 0));
}
