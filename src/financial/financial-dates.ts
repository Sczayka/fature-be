import { addDays, utcMidnight } from '../invoices/pricing/dates.js';

/** Data (YYYY-MM-DD) de um dia gravado à meia-noite UTC. */
export function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function toDateOnlyOrNull(date: Date | null): string | null {
  return date ? toDateOnly(date) : null;
}

/** Mês de referência (YYYY-MM) de um dia gravado à meia-noite UTC. */
export function toCompetence(date: Date): string {
  return date.toISOString().slice(0, 7);
}

/** Dia 1 do mês de referência (YYYY-MM), à meia-noite UTC, como a folha grava. */
export function competenceStart(competence: string): Date {
  return utcMidnight(`${competence}-01`);
}

/** Mês de referência como a tela mostra (MM/AAAA). */
export function formatCompetence(competence: string): string {
  const [year, month] = competence.split('-');

  return `${month}/${year}`;
}

/** Primeiro dia (YYYY-MM-DD) do mês de uma data. */
export function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

/** Último dia (YYYY-MM-DD) do mês de uma data. */
export function monthEnd(date: string): string {
  const [year, month] = date.split('-').map(Number);

  // Dia 0 do mês seguinte é o último deste
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

/** O dia seguinte (YYYY-MM-DD). */
export function nextDay(date: string): string {
  return addDays(date, 1);
}
