import { paymentTermError } from './payment-term.js';

describe('paymentTermError', () => {
  it('accepts cash, single and installment terms, and no term at all', () => {
    expect(paymentTermError([0])).toBeNull();
    expect(paymentTermError([30])).toBeNull();
    expect(paymentTermError([30, 60, 90])).toBeNull();
    expect(paymentTermError([0, 30, 60])).toBeNull();
    expect(paymentTermError([])).toBeNull();
  });

  it('accepts up to 12 installments', () => {
    const days = Array.from({ length: 12 }, (_, index) => (index + 1) * 30);

    expect(paymentTermError(days)).toBeNull();
    expect(paymentTermError([...days, 390])).toContain('até 12 parcelas');
  });

  it('rejects days out of range or not integers', () => {
    expect(paymentTermError([-1])).toContain('de 0 a 365 dias');
    expect(paymentTermError([366])).toContain('de 0 a 365 dias');
    expect(paymentTermError([30.5])).toContain('de 0 a 365 dias');
    expect(paymentTermError(['30'])).toContain('de 0 a 365 dias');
  });

  it('rejects installments out of order or repeated', () => {
    expect(paymentTermError([60, 30])).toContain('ordem crescente');
    expect(paymentTermError([30, 30])).toContain('ordem crescente');
  });

  it('rejects anything other than a list', () => {
    expect(paymentTermError('30/60/90')).toContain('lista de dias');
    expect(paymentTermError(null)).toContain('lista de dias');
  });
});
