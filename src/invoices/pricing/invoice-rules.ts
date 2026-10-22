import { formatDateBR } from '../../common/utils/format.js';
import {
  AmountType,
  PaymentMethod,
  PromotionApplication,
} from '../invoices.constants.js';
import {
  DiscountRules,
  InterestAndFineRules,
  ItemDiscountRule,
  PromotionRules,
  calcLineDiscount,
  roundCurrency,
} from './invoice-pricing.js';

export interface IssuingItem {
  id: string;
  price: number;
  quantity: number;
  total: number;
}

/** Promoção como está cadastrada agora, para conferir a aplicada na cobrança. Datas em YYYY-MM-DD. */
export interface IssuingPromotion {
  id: string;
  name: string;
  type: AmountType;
  value: number;
  application: PromotionApplication;
  maxAmount: number | null;
  maxQuantity: number | null;
  startsAt: string | null;
  endsAt: string | null;
  active: boolean;
  itemIds: string[];
}

export interface IssuingInput {
  clientId: string;
  items: IssuingItem[];
  dueDate: string;
  paymentMethods: PaymentMethod[];
  discount: DiscountRules;
  interestAndFine: InterestAndFineRules;
  /** Promoções da organização citadas nos descontos por item (as de outra não vêm). */
  promotions: IssuingPromotion[];
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

  // Linhas com o total esperado (preço × quantidade), base dos descontos por item
  const lines = new Map<string, IssuingItem>();

  input.items.forEach((item, index) => {
    const expectedTotal = roundCurrency(item.price * item.quantity);

    if (lines.has(item.id))
      addIssue(
        `items.${index}.item.id`,
        'Item repetido na cobrança; ajuste a quantidade',
      );

    if (item.total !== expectedTotal)
      addIssue(
        `items.${index}.total`,
        `Total do item diferente de preço × quantidade (esperado ${expectedTotal})`,
      );

    lines.set(item.id, { ...item, total: expectedTotal });
  });

  if (input.dueDate < today)
    addIssue(
      'billing.dueDate',
      'A data de vencimento não pode estar no passado',
    );

  const discountedItems = new Set<string>();

  input.discount.items.forEach((rule, index) => {
    const path = `discount.items.${index}`;
    const line = lines.get(rule.id);

    if (!line) {
      addIssue(
        `${path}.id`,
        'O desconto se refere a um item que não está na cobrança',
      );
      return;
    }

    if (discountedItems.has(rule.id))
      addIssue(`${path}.id`, 'Há mais de um desconto para o mesmo item');

    discountedItems.add(rule.id);

    // A promoção limita o desconto ao valor da linha e ao teto dela
    if (rule.promotion) {
      const message = promotionIssue(
        rule,
        rule.promotion,
        input.promotions,
        today,
      );

      if (message) addIssue(`${path}.promotion`, message);
      return;
    }

    if (rule.value && rule.type === 'FIXED' && rule.value > line.total)
      addIssue(`${path}.value`, 'Desconto maior que o valor do item');
  });

  const subtotal = roundCurrency(
    [...lines.values()].reduce((acc, line) => acc + line.total, 0),
  );
  const itemsDiscount = roundCurrency(
    input.discount.items.reduce((acc, rule) => {
      const line = lines.get(rule.id);
      return line ? acc + calcLineDiscount(line, rule) : acc;
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

/**
 * Motivo para recusar a promoção aplicada a um item; null quando ela vale hoje para ele com as
 * mesmas regras. O front não é a fonte: a promoção pode ter mudado depois de aplicada (inclusive
 * entre o orçamento e a conversão).
 */
function promotionIssue(
  applied: ItemDiscountRule,
  rules: PromotionRules,
  promotions: IssuingPromotion[],
  today: string,
): string | null {
  const promotion = promotions.find((row) => row.id === rules.id);

  if (!promotion) return 'A promoção aplicada ao item não existe mais';

  const subject = `A promoção ${promotion.name}`;

  if (!promotion.active) return `${subject} está inativa`;

  if (promotion.startsAt && promotion.startsAt > today)
    return `${subject} só vale a partir de ${formatDateBR(promotion.startsAt)}`;

  if (promotion.endsAt && promotion.endsAt < today)
    return `${subject} venceu em ${formatDateBR(promotion.endsAt)}`;

  if (!promotion.itemIds.includes(applied.id))
    return `${subject} não vale para este item`;

  const sameRules =
    applied.type === promotion.type &&
    applied.value === promotion.value &&
    rules.application === promotion.application &&
    rules.maxAmount === promotion.maxAmount &&
    rules.maxQuantity === promotion.maxQuantity;

  return sameRules
    ? null
    : `${subject} mudou depois de aplicada: escolha-a de novo no desconto do item`;
}
