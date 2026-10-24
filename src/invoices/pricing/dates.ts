import { BILLING_TIMEZONE } from '../invoices.constants.js';

const DAY_IN_MS = 24 * 60 * 60 * 1000;

/** Data atual (YYYY-MM-DD) no fuso de cobrança. */
export function todayInBillingTimezone(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BILLING_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Data YYYY-MM-DD somada de `days` dias corridos (negativo volta no calendário). */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_IN_MS)
    .toISOString()
    .slice(0, 10);
}

/** Instante em que as datas da fatura são gravadas (meia-noite UTC), para filtrar por vencimento. */
export function utcMidnight(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

/**
 * Instante em que o dia (YYYY-MM-DD) começa no fuso de cobrança, para filtrar instantes como o
 * `createdAt`. As datas da fatura ficam à meia-noite UTC: para elas, `utcMidnight`.
 */
export function startOfDayInBillingTimezone(date: string): Date {
  const midnight = Date.parse(`${date}T00:00:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BILLING_TIMEZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(midnight));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((row) => row.type === type)?.value);
  // Diferença do relógio do fuso para o UTC naquele instante (-3h em São Paulo)
  const offset =
    Date.UTC(
      part('year'),
      part('month') - 1,
      part('day'),
      part('hour'),
      part('minute'),
      part('second'),
    ) - midnight;

  return new Date(midnight - offset);
}

/** Dias corridos entre duas datas YYYY-MM-DD (positivo quando `to` é posterior). */
export function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      DAY_IN_MS,
  );
}

/**
 * Data de um pagamento (YYYY-MM-DD): o provedor informa só a data (gravada à meia-noite UTC); o
 * cartão aprovado na hora grava o instante, convertido para o fuso de cobrança.
 */
export function paidDate(paidAt: Date): string {
  const iso = paidAt.toISOString();

  return iso.endsWith('T00:00:00.000Z')
    ? iso.slice(0, 10)
    : todayInBillingTimezone(paidAt);
}
