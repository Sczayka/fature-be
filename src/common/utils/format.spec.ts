import {
  formatBRL,
  formatCpfCnpj,
  formatDateBR,
  formatInstantDateBR,
  formatPercent,
  formatPhoneBR,
} from './format.js';

describe('format', () => {
  it('formats reais with the pt-BR separators', () => {
    expect(formatBRL(1200.5)).toBe('R$ 1.200,50');
    expect(formatBRL(0)).toBe('R$ 0,00');
  });

  it('formats a YYYY-MM-DD date without shifting the timezone', () => {
    expect(formatDateBR('2026-10-01')).toBe('01/10/2026');
    expect(formatDateBR('2026-10-01T00:00:00.000Z')).toBe('01/10/2026');
  });

  it('formats percentages with a decimal comma', () => {
    expect(formatPercent(2.5)).toBe('2,5%');
    expect(formatPercent(10)).toBe('10%');
  });

  it('masks CPF and CNPJ digits and keeps anything else', () => {
    expect(formatCpfCnpj('12345678909')).toBe('123.456.789-09');
    expect(formatCpfCnpj('11222333000181')).toBe('11.222.333/0001-81');
    expect(formatCpfCnpj('11.222.333/0001-81')).toBe('11.222.333/0001-81');
    expect(formatCpfCnpj('123')).toBe('123');
  });

  it('masks landline and mobile numbers with the area code', () => {
    expect(formatPhoneBR('1133334444')).toBe('(11) 3333-4444');
    expect(formatPhoneBR('11988887777')).toBe('(11) 98888-7777');
    expect(formatPhoneBR('+1 555 0100')).toBe('+1 555 0100');
  });

  it('formats an instant in the billing timezone', () => {
    // 01:00 UTC ainda é o dia anterior em São Paulo
    expect(formatInstantDateBR(new Date('2026-10-18T01:00:00Z'))).toBe(
      '17/10/2026',
    );
  });
});
