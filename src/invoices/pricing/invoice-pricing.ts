import { AmountType, PaymentMethod } from '../invoices.constants.js';
import { daysBetween } from './dates.js';

/**
 * Cálculo de valores da cobrança: fonte única da verdade para o boleto (configurado no
 * provedor) e para PIX/cartões (calculados pelo Fature no checkout).
 *
 * Regras:
 * - Desconto por item abate o preço: reduz o valor nominal e vale sempre, inclusive em atraso.
 * - Desconto por forma de pagamento incide sobre o valor nominal e vale até `limitDate`
 *   (inclusive); sem `limitDate`, vale até o vencimento.
 * - Após o vencimento: valor nominal + multa + juros (pro rata, mês de 30 dias).
 * - Arredondamento idêntico ao do fature-fe (`roundCurrency`).
 */

export interface PricingItem {
  id: string;
  total: number;
}

export interface AmountRule {
  type: AmountType;
  value: number;
}

export interface ItemDiscountRule extends AmountRule {
  id: string;
}

export interface MethodDiscountRule extends AmountRule {
  method: PaymentMethod;
  limitDate: string;
}

export interface DiscountRules {
  items: ItemDiscountRule[];
  methods: MethodDiscountRule[];
}

export interface InterestAndFineRules {
  fineType: AmountType;
  fineValue: number;
  interestType: AmountType;
  interestValue: number;
}

export interface InvoicePricingRules {
  items: PricingItem[];
  dueDate: string;
  discount: DiscountRules;
  interestAndFine: InterestAndFineRules;
}

export interface InvoiceQuote {
  phase: 'ON_TIME' | 'OVERDUE';
  subtotal: number;
  itemsDiscount: number;
  nominalValue: number;
  methodDiscount: number;
  fine: number;
  interest: number;
  daysLate: number;
  total: number;
}

export interface BankSlipCharge {
  value: number;
  dueDate: string;
  discount: { type: 'FIXED'; value: number; dueDateLimitDays: number } | null;
  fine: { type: 'FIXED'; value: number };
  interest: { value: number };
}

export function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Valor (R$) de um desconto sobre uma base, limitado a [0, base]. */
export function calcDiscountAmount(base: number, rule: AmountRule) {
  if (!rule.value || base <= 0) return 0;

  const amount =
    rule.type === 'PERCENTAGE' ? (base * rule.value) / 100 : rule.value;

  return roundCurrency(Math.min(Math.max(amount, 0), base));
}

export function calcSubtotal(items: PricingItem[]): number {
  return roundCurrency(items.reduce((acc, item) => acc + item.total, 0));
}

export function calcItemsDiscount(rules: InvoicePricingRules): number {
  return roundCurrency(
    rules.discount.items.reduce((acc, rule) => {
      const item = rules.items.find((row) => row.id === rule.id);

      return item ? acc + calcDiscountAmount(item.total, rule) : acc;
    }, 0),
  );
}

/** Valor nominal: subtotal dos itens menos os descontos por item. */
export function calcNominalValue(rules: InvoicePricingRules): number {
  return roundCurrency(calcSubtotal(rules.items) - calcItemsDiscount(rules));
}

/** Data até a qual o desconto por forma de pagamento vale. */
export function discountDeadline(
  rule: MethodDiscountRule,
  dueDate: string,
): string {
  return rule.limitDate || dueDate;
}

/** Multa em R$ sobre o valor nominal. */
export function calcFineAmount(rules: InvoicePricingRules): number {
  const { fineType, fineValue } = rules.interestAndFine;

  if (fineValue <= 0) return 0;

  return fineType === 'FIXED'
    ? roundCurrency(fineValue)
    : roundCurrency((calcNominalValue(rules) * fineValue) / 100);
}

/**
 * Percentual de juros ao mês. O Asaas só aceita juros percentuais, então juros FIXED (R$/mês)
 * são convertidos sobre o valor nominal; o mesmo percentual é usado para todos os métodos.
 */
export function calcInterestPercent(rules: InvoicePricingRules): number {
  const { interestType, interestValue } = rules.interestAndFine;
  const nominalValue = calcNominalValue(rules);

  if (interestValue <= 0 || nominalValue <= 0) return 0;

  return interestType === 'PERCENTAGE'
    ? interestValue
    : roundCurrency((interestValue / nominalValue) * 100);
}

/** Valor a pagar por um método em uma data (YYYY-MM-DD). */
export function getQuote(
  rules: InvoicePricingRules,
  method: PaymentMethod,
  date: string,
): InvoiceQuote {
  const subtotal = calcSubtotal(rules.items);
  const itemsDiscount = calcItemsDiscount(rules);
  const nominalValue = calcNominalValue(rules);

  if (date > rules.dueDate) {
    const daysLate = daysBetween(rules.dueDate, date);
    const fine = calcFineAmount(rules);
    const interest = roundCurrency(
      (nominalValue * calcInterestPercent(rules) * daysLate) / 100 / 30,
    );

    return {
      phase: 'OVERDUE',
      subtotal,
      itemsDiscount,
      nominalValue,
      methodDiscount: 0,
      fine,
      interest,
      daysLate,
      total: roundCurrency(nominalValue + fine + interest),
    };
  }

  const methodRule = rules.discount.methods.find(
    (rule) => rule.method === method,
  );
  const methodDiscount =
    methodRule && date <= discountDeadline(methodRule, rules.dueDate)
      ? calcDiscountAmount(nominalValue, methodRule)
      : 0;

  return {
    phase: 'ON_TIME',
    subtotal,
    itemsDiscount,
    nominalValue,
    methodDiscount,
    fine: 0,
    interest: 0,
    daysLate: 0,
    total: roundCurrency(nominalValue - methodDiscount),
  };
}

/**
 * Configuração do boleto no provedor: valor nominal (já com os descontos por item) e o
 * desconto do boleto com o seu prazo. Desconto e multa vão como valores FIXED já calculados
 * para o provedor não reaplicar percentuais com outro arredondamento.
 */
export function buildBankSlipCharge(
  rules: InvoicePricingRules,
): BankSlipCharge {
  const value = calcNominalValue(rules);
  const bankSlipRule = rules.discount.methods.find(
    (rule) => rule.method === 'BANK_SLIP',
  );
  const discountValue = bankSlipRule
    ? calcDiscountAmount(value, bankSlipRule)
    : 0;

  return {
    value,
    dueDate: rules.dueDate,
    discount:
      bankSlipRule && discountValue > 0
        ? {
            type: 'FIXED',
            value: discountValue,
            dueDateLimitDays: daysBetween(
              discountDeadline(bankSlipRule, rules.dueDate),
              rules.dueDate,
            ),
          }
        : null,
    fine: { type: 'FIXED', value: calcFineAmount(rules) },
    interest: { value: calcInterestPercent(rules) },
  };
}
