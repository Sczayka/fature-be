import { QuoteDraft, toQuoteDocument } from './quote-document.js';

function buildDraft(overrides: Partial<QuoteDraft> = {}): QuoteDraft {
  return {
    client: {
      id: 'client-1',
      name: ' Maria ',
      email: 'maria@exemplo.com',
      cpfCnpj: '123.456.789-09',
      phone: '',
      mobile: '(11) 98888-7777',
    },
    items: [
      {
        item: { id: 'item-1', name: 'Site', type: 'service', price: 500 },
        quantity: 2,
        total: 1000,
      },
      {
        item: { id: 'item-2', name: 'Hospedagem', type: 'service', price: 50 },
        quantity: 2,
        total: 100,
      },
    ],
    billing: {
      dueDate: '2026-11-10',
      referenceDate: '',
      description: 'Projeto do site',
    },
    paymentMethods: ['PIX', 'BANK_SLIP'],
    discount: {
      items: [{ id: 'item-1', type: 'PERCENTAGE', value: 10 }],
      methods: [{ method: 'PIX', type: 'PERCENTAGE', value: 5, limitDate: '' }],
    },
    interestAndFine: {
      fineType: 'PERCENTAGE',
      fineValue: 2,
      interestType: 'FIXED',
      interestValue: 1.5,
    },
    updatedAt: new Date('2026-10-18T15:00:00Z'),
    organization: {
      name: 'Raipp',
      logo: 'https://api.fature.com.br/logos/org-1?v=1',
      backgroundColor: null,
      buttonColor: '#123456',
      contactEmail: 'contato@raipp.com',
      phone: '1133334444',
      mobilePhone: null,
      cnpj: '11222333000181',
      logoImage: { mimeType: 'image/png', data: new Uint8Array([1, 2, 3]) },
    },
    ...overrides,
  };
}

describe('toQuoteDocument', () => {
  it('prices the lines with the same rules as the invoice', () => {
    const quote = toQuoteDocument(buildDraft());

    expect(quote.lines).toEqual([
      { name: 'Site', quantity: 2, unitPrice: 500, total: 1000, discount: 100 },
      {
        name: 'Hospedagem',
        quantity: 2,
        unitPrice: 50,
        total: 100,
        discount: 0,
      },
    ]);
    expect(quote).toMatchObject({
      subtotal: 1100,
      itemsDiscount: 100,
      total: 1000,
      dueDate: '2026-11-10',
      description: 'Projeto do site',
    });
  });

  it('lists the payment methods in the usual order with their discounts', () => {
    const quote = toQuoteDocument(buildDraft());

    expect(quote.paymentMethods).toEqual([
      { label: 'Boleto bancário', discount: 0, discountUntil: null },
      // Sem data limite, o desconto vale até o vencimento
      { label: 'PIX', discount: 50, discountUntil: '2026-11-10' },
    ]);
    expect(quote.lateCharges).toBe(
      'Após o vencimento: multa de 2% e juros de R$ 1,50 ao mês.',
    );
  });

  it('formats the company and client contacts', () => {
    const quote = toQuoteDocument(buildDraft());

    expect(quote.organization).toMatchObject({
      name: 'Raipp',
      document: '11.222.333/0001-81',
      email: 'contato@raipp.com',
      phone: '(11) 3333-4444',
      accentColor: '#123456',
    });
    expect(quote.organization.logo).toEqual(Buffer.from([1, 2, 3]));
    expect(quote.client).toEqual({
      name: 'Maria',
      document: '123.456.789-09',
      email: 'maria@exemplo.com',
      phone: '(11) 98888-7777',
    });
  });

  it('leaves out a logo the PDF cannot embed', () => {
    const draft = buildDraft();
    const quote = toQuoteDocument({
      ...draft,
      organization: {
        ...draft.organization,
        logoImage: { mimeType: 'image/webp', data: new Uint8Array([1]) },
      },
    });

    expect(quote.organization.logo).toBeNull();
  });

  it('accepts a draft saved halfway', () => {
    const quote = toQuoteDocument(
      buildDraft({
        client: null,
        items: [],
        billing: null,
        paymentMethods: [],
        discount: null,
        interestAndFine: null,
      }),
    );

    expect(quote).toMatchObject({
      client: { name: null, document: null, email: null, phone: null },
      description: null,
      lines: [],
      total: 0,
      dueDate: null,
      paymentMethods: [],
      lateCharges: null,
    });
  });

  it('has no deadline for a method discount when the draft has no due date', () => {
    const quote = toQuoteDocument(
      buildDraft({ billing: { dueDate: '', description: '' } }),
    );

    expect(quote.paymentMethods[1]).toEqual({
      label: 'PIX',
      discount: 50,
      discountUntil: null,
    });
  });
});
