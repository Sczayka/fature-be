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

/** Dias corridos entre duas datas YYYY-MM-DD (positivo quando `to` é posterior). */
export function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      DAY_IN_MS,
  );
}
