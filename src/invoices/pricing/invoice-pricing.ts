import { roundCurrency } from '../../common/utils/currency.js';
import { AmountType, PaymentMethod } from '../invoices.constants.js';
import { daysBetween } from './dates.js';

export { roundCurrency };

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
  /** Último dia (YYYY-MM-DD) em que `total` vale: fim do desconto do método, vencimento ou, em atraso, o próprio dia. */
  validUntil: string;
}

/** Regras do boleto que o provedor aplica sozinho: desconto até uma data, multa e juros. */
export interface BankSlipCharge {
  value: number;
  dueDate: string;
  /** Desconto em R$ válido até `until` (inclusive). */
  discount: { value: number; until: string } | null;
  /** Multa em R$. */
  fine: number;
  /** Juros em % ao mês. */
  interestPercent: number;
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

/** Desconto (R$) que abate o preço de um item. */
export function calcItemDiscount(
  rules: InvoicePricingRules,
  item: PricingItem,
): number {
  const rule = rules.discount.items.find((row) => row.id === item.id);

  return rule ? calcDiscountAmount(item.total, rule) : 0;
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
      // Os juros mudam a cada dia de atraso
      validUntil: date,
    };
  }

  const methodRule = rules.discount.methods.find(
    (rule) => rule.method === method,
  );
  const deadline = methodRule
    ? discountDeadline(methodRule, rules.dueDate)
    : null;
  const methodDiscount =
    methodRule && deadline && date <= deadline
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
    validUntil: methodDiscount > 0 && deadline ? deadline : rules.dueDate,
  };
}

/**
 * Configuração do boleto no provedor: valor nominal (já com os descontos por item) e o
 * desconto do boleto com o seu prazo. Desconto e multa vão em R$ já calculados para o
 * provedor não reaplicar percentuais com outro arredondamento.
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
            value: discountValue,
            until: discountDeadline(bankSlipRule, rules.dueDate),
          }
        : null,
    fine: calcFineAmount(rules),
    interestPercent: calcInterestPercent(rules),
  };
}

/** Fatura como gravada: itens, vencimento e as regras de desconto e encargos da emissão. */
export interface StoredInvoicePricing {
  items: unknown;
  dueDate: Date;
  discount: unknown;
  interestAndFine: unknown;
}

/** Regras de preço de uma fatura salva, para calcular o valor do dia no checkout. */
export function pricingRulesFromInvoice(
  invoice: StoredInvoicePricing,
): InvoicePricingRules {
  const items = (invoice.items as PricingItem[]).map(({ id, total }) => ({
    id,
    total,
  }));
  const discount = invoice.discount as Partial<DiscountRules> | null;
  const interestAndFine =
    invoice.interestAndFine as InterestAndFineRules | null;

  return {
    items,
    // Gravado à meia-noite UTC: só a data importa
    dueDate: invoice.dueDate.toISOString().slice(0, 10),
    discount: {
      items: discount?.items ?? [],
      methods: discount?.methods ?? [],
    },
    interestAndFine: interestAndFine ?? {
      fineType: 'PERCENTAGE',
      fineValue: 0,
      interestType: 'PERCENTAGE',
      interestValue: 0,
    },
  };
}
