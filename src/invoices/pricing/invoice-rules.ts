import { PaymentMethod } from '../invoices.constants.js';
import {
  DiscountRules,
  InterestAndFineRules,
  calcDiscountAmount,
  roundCurrency,
} from './invoice-pricing.js';

export interface IssuingItem {
  id: string;
  price: number;
  quantity: number;
  total: number;
}

export interface IssuingInput {
  clientId: string;
  items: IssuingItem[];
  dueDate: string;
  paymentMethods: PaymentMethod[];
  discount: DiscountRules;
  interestAndFine: InterestAndFineRules;
}

export interface InvoiceRuleIssue {
  path: string;
  message: string;
}

/**
 * Regras de negócio exigidas apenas na emissão de uma cobrança (não se aplicam a orçamentos).
 * Os caminhos seguem o payload de entrada. Descontos com valor 0 são ignorados.
 */
export function validateIssuingRules(
  input: IssuingInput,
  today: string,
): InvoiceRuleIssue[] {
  const issues: InvoiceRuleIssue[] = [];
  const addIssue = (path: string, message: string) =>
    issues.push({ path, message });

  if (!input.clientId.trim())
    addIssue(
      'client.id',
      'Selecione um cliente cadastrado para emitir a cobrança',
    );

  const itemTotals = new Map<string, number>();

  input.items.forEach((item, index) => {
    const expectedTotal = roundCurrency(item.price * item.quantity);

    if (itemTotals.has(item.id))
      addIssue(
        `items.${index}.item.id`,
        'Item repetido na cobrança; ajuste a quantidade',
      );

    if (item.total !== expectedTotal)
      addIssue(
        `items.${index}.total`,
        `Total do item diferente de preço × quantidade (esperado ${expectedTotal})`,
      );

    itemTotals.set(item.id, expectedTotal);
  });

  if (input.dueDate < today)
    addIssue(
      'billing.dueDate',
      'A data de vencimento não pode estar no passado',
    );

  const discountedItems = new Set<string>();

  input.discount.items.forEach((rule, index) => {
    const path = `discount.items.${index}`;
    const itemTotal = itemTotals.get(rule.id);

    if (itemTotal === undefined) {
      addIssue(
        `${path}.id`,
        'O desconto se refere a um item que não está na cobrança',
      );
      return;
    }

    if (discountedItems.has(rule.id))
      addIssue(`${path}.id`, 'Há mais de um desconto para o mesmo item');

    discountedItems.add(rule.id);

    if (rule.value && rule.type === 'FIXED' && rule.value > itemTotal)
      addIssue(`${path}.value`, 'Desconto maior que o valor do item');
  });

  const subtotal = roundCurrency(
    [...itemTotals.values()].reduce((acc, total) => acc + total, 0),
  );
  const itemsDiscount = roundCurrency(
    input.discount.items.reduce((acc, rule) => {
      const itemTotal = itemTotals.get(rule.id);
      return itemTotal === undefined
        ? acc
        : acc + calcDiscountAmount(itemTotal, rule);
    }, 0),
  );
  const nominalValue = roundCurrency(subtotal - itemsDiscount);
  const discountedMethods = new Set<PaymentMethod>();

  input.discount.methods.forEach((rule, index) => {
    const path = `discount.methods.${index}`;

    if (!input.paymentMethods.includes(rule.method))
      addIssue(
        `${path}.method`,
        'Desconto para uma forma de pagamento que não está habilitada na cobrança',
      );

    if (discountedMethods.has(rule.method))
      addIssue(
        `${path}.method`,
        `Há mais de um desconto para a forma de pagamento ${rule.method}`,
      );

    discountedMethods.add(rule.method);

    if (!rule.value) return;

    if (rule.type === 'FIXED' && rule.value > nominalValue)
      addIssue(`${path}.value`, 'Desconto maior que o subtotal');

    if (rule.limitDate > input.dueDate)
      addIssue(
        `${path}.limitDate`,
        'A data limite do desconto não pode ser posterior ao vencimento',
      );
    else if (rule.limitDate && rule.limitDate < today)
      addIssue(`${path}.limitDate`, 'A data limite do desconto já passou');
  });

  return issues;
}
