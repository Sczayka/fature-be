import { formatBRL, formatDateBR, formatInstantDateBR } from './format.js';

describe('format', () => {
  it('formats reais with the pt-BR separators', () => {
    expect(formatBRL(1200.5)).toBe('R$ 1.200,50');
    expect(formatBRL(0)).toBe('R$ 0,00');
  });

  it('formats a YYYY-MM-DD date without shifting the timezone', () => {
    expect(formatDateBR('2026-10-01')).toBe('01/10/2026');
    expect(formatDateBR('2026-10-01T00:00:00.000Z')).toBe('01/10/2026');
  });

  it('formats an instant in the billing timezone', () => {
    // 01:00 UTC ainda é o dia anterior em São Paulo
    expect(formatInstantDateBR(new Date('2026-10-18T01:00:00Z'))).toBe(
      '17/10/2026',
    );
  });
});
