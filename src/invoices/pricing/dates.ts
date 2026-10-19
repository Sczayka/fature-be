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

/** Dias corridos entre duas datas YYYY-MM-DD (positivo quando `to` é posterior). */
export function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      DAY_IN_MS,
  );
}
