import type { QuoteDocument } from './quote-document.js';
import { pdfText, quotePdfFilename, renderQuotePdf } from './quote-pdf.js';

function buildQuote(overrides: Partial<QuoteDocument> = {}): QuoteDocument {
  return {
    issuedAt: new Date('2026-10-18T15:00:00Z'),
    organization: {
      name: 'Raipp',
      document: '11.222.333/0001-81',
      email: 'contato@raipp.com',
      phone: '(11) 3333-4444',
      accentColor: '#2bc4a0',
      logo: null,
    },
    client: {
      name: 'Maria José',
      document: '123.456.789-09',
      email: 'maria@exemplo.com',
      phone: null,
    },
    description: 'Projeto do site',
    lines: [
      {
        name: 'Site',
        quantity: 1,
        unitPrice: 1000,
        total: 1000,
        discount: 100,
      },
    ],
    subtotal: 1000,
    itemsDiscount: 100,
    total: 900,
    dueDate: '2026-11-10',
    paymentMethods: [
      { label: 'PIX', discount: 45, discountUntil: '2026-11-10' },
    ],
    lateCharges: 'Após o vencimento: multa de 2%.',
    ...overrides,
  };
}

function pageCount(pdf: Buffer): number {
  return pdf.toString('latin1').match(/\/Type \/Page\b/g)?.length ?? 0;
}

describe('renderQuotePdf', () => {
  it('renders a one-page PDF', async () => {
    const pdf = await renderQuotePdf(buildQuote());

    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pageCount(pdf)).toBe(1);
  });

  it('breaks long quotes into pages', async () => {
    const lines = Array.from({ length: 60 }, (_, index) => ({
      name: `Item ${index + 1}`,
      quantity: 1,
      unitPrice: 10,
      total: 10,
      discount: 0,
    }));

    const pdf = await renderQuotePdf(buildQuote({ lines }));

    expect(pageCount(pdf)).toBeGreaterThan(1);
  });

  it('falls back to the company name when the logo cannot be read', async () => {
    const quote = buildQuote();
    const pdf = await renderQuotePdf({
      ...quote,
      organization: {
        ...quote.organization,
        logo: Buffer.from('not-an-image'),
      },
    });

    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });
});

describe('pdfText', () => {
  it('keeps Portuguese accents and typographic marks', () => {
    expect(pdfText('Orçamento “Ação” — R$ 1.000,00')).toBe(
      'Orçamento “Ação” — R$ 1.000,00',
    );
  });

  it('drops what the standard PDF fonts cannot draw', () => {
    expect(pdfText('Pacote 🚀 Ōsaka')).toBe('Pacote  Osaka');
  });
});

describe('quotePdfFilename', () => {
  it('names the file after the client', () => {
    expect(quotePdfFilename(buildQuote())).toBe('orcamento-maria-jose.pdf');
  });

  it('uses the company when the quote has no client', () => {
    const quote = buildQuote();

    expect(
      quotePdfFilename({ ...quote, client: { ...quote.client, name: null } }),
    ).toBe('orcamento-raipp.pdf');
  });
});
