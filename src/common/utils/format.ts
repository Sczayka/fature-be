import { BILLING_TIMEZONE } from '../../invoices/invoices.constants.js';

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

/** Valor em reais (ex.: "R$ 1.200,50"); o Intl separa o símbolo com espaço não separável. */
export function formatBRL(value: number): string {
  return BRL.format(value);
}

const DECIMAL = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

/** Percentual com vírgula decimal (ex.: "2,5%"). */
export function formatPercent(value: number): string {
  return `${DECIMAL.format(value)}%`;
}

/** CPF (11 dígitos) ou CNPJ (14) com a máscara; outros valores voltam como vieram. */
export function formatCpfCnpj(value: string): string {
  const digits = value.replace(/\D/g, '');

  if (digits.length === 11) {
    return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  }

  if (digits.length === 14) {
    return digits.replace(
      /(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/,
      '$1.$2.$3/$4-$5',
    );
  }

  return value;
}

/** Telefone fixo (10 dígitos) ou celular (11) com DDD; outros valores voltam como vieram. */
export function formatPhoneBR(value: string): string {
  const digits = value.replace(/\D/g, '');

  if (digits.length === 10) {
    return digits.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
  }

  if (digits.length === 11) {
    return digits.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
  }

  return value;
}

/** Data YYYY-MM-DD como dd/mm/aaaa, sem passar por fuso horário. */
export function formatDateBR(date: string): string {
  const [year, month, day] = date.slice(0, 10).split('-');

  return `${day}/${month}/${year}`;
}

/** Data de um instante no fuso de cobrança, como dd/mm/aaaa. */
export function formatInstantDateBR(instant: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: BILLING_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(instant);
}
