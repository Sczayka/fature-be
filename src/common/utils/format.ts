import { BILLING_TIMEZONE } from '../../invoices/invoices.constants.js';

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

/** Valor em reais (ex.: "R$ 1.200,50"); o Intl separa o símbolo com espaço não separável. */
export function formatBRL(value: number): string {
  return BRL.format(value);
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
