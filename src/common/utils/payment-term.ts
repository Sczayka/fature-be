export const PAYMENT_TERM_MAX_INSTALLMENTS = 12;
export const PAYMENT_TERM_MAX_DAYS = 365;

/**
 * Prazo de pagamento: dias de cada parcela, contados da compra ([30], [30, 60, 90] ou [0], à vista).
 * Devolve o motivo pelo qual o prazo é inválido, ou null quando é válido. Vazio é "não informado".
 */
export function paymentTermError(days: unknown): string | null {
  if (!Array.isArray(days)) {
    return 'Informe o prazo de pagamento como uma lista de dias';
  }

  if (days.length > PAYMENT_TERM_MAX_INSTALLMENTS) {
    return `O prazo de pagamento aceita até ${PAYMENT_TERM_MAX_INSTALLMENTS} parcelas`;
  }

  const isDay = (day: unknown) =>
    Number.isInteger(day) &&
    (day as number) >= 0 &&
    (day as number) <= PAYMENT_TERM_MAX_DAYS;

  if (!days.every(isDay)) {
    return `Cada parcela deve vencer de 0 a ${PAYMENT_TERM_MAX_DAYS} dias após a compra`;
  }

  if (days.some((day, index) => index > 0 && day <= days[index - 1])) {
    return 'As parcelas do prazo de pagamento devem estar em ordem crescente, sem repetir dias';
  }

  return null;
}
