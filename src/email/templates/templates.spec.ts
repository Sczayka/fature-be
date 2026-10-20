import {
  brandFromOrganization,
  createBrand,
  fatureBrand,
  isDarkColor,
} from './brand.js';
import { renderEmailVerificationEmail } from './email-verification.template.js';
import { escapeHtml, safeUrl } from './html.js';
import type { OpenInvoiceEmailData } from './invoice-content.js';
import { renderInvoiceIssuedEmail } from './invoice-issued.template.js';
import { renderInvoiceOverdueEmail } from './invoice-overdue.template.js';
import { renderInvoicePaidEmail } from './invoice-paid.template.js';
import { renderInvoicePartiallyPaidEmail } from './invoice-partially-paid.template.js';
import { renderInvoiceReminderEmail } from './invoice-reminder.template.js';
import { renderOrganizationInvitationEmail } from './organization-invitation.template.js';
import { renderPasswordResetEmail } from './password-reset.template.js';
import { PayerContext, payerContext } from './payer.js';
import { renderPaymentProofReceivedEmail } from './payment-proof-received.template.js';
import { renderPaymentProofRejectedEmail } from './payment-proof-rejected.template.js';
import { renderQuoteEmail } from './quote.template.js';

const organization = {
  name: 'Raipp <Studio>',
  logo: 'https://api.fature.com.br/logos/org-1?v=1',
  backgroundColor: '#1e293b',
  buttonColor: '#5b3fd1',
  contactEmail: 'contato@raipp.com',
  phone: null,
  mobilePhone: '(11) 99999-0000',
  logoImage: { mimeType: 'image/png' },
};

function openInvoice(payer: PayerContext): OpenInvoiceEmailData {
  return {
    payer,
    clientName: 'Maria <script>alert(1)</script>',
    description: 'Mensalidade de outubro',
    items: [{ name: 'Consultoria', quantity: 2, total: 1200.5 }],
    totalValue: 1200.5,
    dueDate: '2026-10-25',
    paymentMethodLabels: ['Boleto bancário', 'PIX'],
    offers: [{ methodLabel: 'PIX', total: 1140.48, until: '2026-10-20' }],
    checkoutUrl: 'https://app.fature.com.br/pagar/token123',
    bankSlip: {
      identificationField:
        '23793.38128 60000.000003 00000.000400 1 84340000120050',
      url: 'https://sandbox.asaas.com/b/pdf/123',
    },
  };
}

describe('email templates', () => {
  let payer: PayerContext;

  beforeEach(() => {
    vi.stubEnv('EMAIL_FROM', 'cobrancas@mail.fature.com.br');
    vi.stubEnv('FRONTEND_URL', 'https://app.fature.com.br/');
    payer = payerContext(organization);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('html helpers', () => {
    it('escapes user data', () => {
      expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
        '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
      );
    });

    it('only accepts http(s) links', () => {
      expect(safeUrl('javascript:alert(1)')).toBeNull();
      expect(safeUrl('not a url')).toBeNull();
      expect(safeUrl(null)).toBeNull();
      expect(safeUrl('https://app.fature.com.br/pagar/x')).toBe(
        'https://app.fature.com.br/pagar/x',
      );
    });
  });

  describe('brand', () => {
    it('picks the text color with the best contrast', () => {
      expect(isDarkColor('#1e293b')).toBe(true);
      expect(isDarkColor('#f5f5f5')).toBe(false);
      expect(payer.brand).toMatchObject({
        backgroundTextColor: '#ffffff',
        buttonTextColor: '#ffffff',
      });
    });

    it('falls back to the Fature colors', () => {
      expect(
        createBrand({
          name: 'X',
          logoUrl: null,
          backgroundColor: null,
          buttonColor: 'red',
        }),
      ).toMatchObject({ backgroundColor: '#f5f5f5', buttonColor: '#2bc4a0' });
    });

    it('drops WebP logos, which Outlook does not show', () => {
      expect(
        brandFromOrganization({
          ...organization,
          logoImage: { mimeType: 'image/webp' },
        }).logoUrl,
      ).toBeNull();
      expect(payer.brand.logoUrl).toBe(organization.logo);
    });
  });

  it('renders the issued invoice with the payment link, the bank slip and escaped data', () => {
    const email = renderInvoiceIssuedEmail(openInvoice(payer));

    expect(email.subject).toBe(
      'Raipp <Studio> enviou uma fatura de R$ 1.200,50 (vence em 25/10/2026)',
    );
    expect(email.html).toContain('Raipp &lt;Studio&gt;');
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain(
      'href="https://app.fature.com.br/pagar/token123"',
    );
    expect(email.html).toContain('23793.38128 60000.000003');
    expect(email.html).toContain('background-color:#5b3fd1');
    expect(email.text).toContain(
      'Ver fatura e pagar: https://app.fature.com.br/pagar/token123',
    );
    expect(email.text).toContain(
      'Pagando com PIX até 20/10/2026, o valor cai para R$ 1.140,48.',
    );
    expect(email.text).toContain(
      'Baixar o boleto: https://sandbox.asaas.com/b/pdf/123',
    );
    expect(email.text).toContain(
      'Dúvidas? Responda este e-mail para falar com Raipp <Studio>.',
    );
  });

  it('points to the phone when the organization has no contact email', () => {
    const email = renderInvoiceIssuedEmail(
      openInvoice(payerContext({ ...organization, contactEmail: null })),
    );

    expect(email.text).toContain(
      'Este endereço não recebe respostas. Fale com Raipp <Studio> pelo telefone (11) 99999-0000.',
    );
  });

  it('limits the item list', () => {
    const data = openInvoice(payer);
    const email = renderInvoiceIssuedEmail({
      ...data,
      items: Array.from({ length: 12 }, (_, index) => ({
        name: `Item ${index + 1}`,
        quantity: 1,
        total: 10,
      })),
    });

    expect(email.text).toContain('- Item 10 (1x)');
    expect(email.text).not.toContain('Item 11');
    expect(email.text).toContain('+ 2 itens');
  });

  it('renders the reminder with the days until the due date', () => {
    const email = renderInvoiceReminderEmail({
      ...openInvoice(payer),
      daysUntilDue: 3,
    });

    expect(email.subject).toBe(
      'Lembrete: sua fatura de Raipp <Studio> vence em 25/10/2026',
    );
    expect(email.text).toContain('Sua fatura vence em 3 dias');
  });

  it('shows the amount with fine and interest on the overdue email', () => {
    const email = renderInvoiceOverdueEmail({
      payer,
      clientName: 'Maria',
      description: null,
      totalValue: 100,
      dueDate: '2026-10-15',
      amountToday: 102.1,
      checkoutUrl: 'https://app.fature.com.br/pagar/token123',
    });

    expect(email.subject).toBe(
      'Fatura de Raipp <Studio> vencida em 15/10/2026',
    );
    expect(email.text).toContain(
      'Valor para pagar hoje (com multa e juros): R$ 102,10',
    );
  });

  it('links the receipt on the paid email, or the invoice without it', () => {
    const data = {
      payer,
      clientName: 'Maria',
      description: null,
      paidAt: '2026-10-18',
      paidValue: 100,
      methodLabel: 'PIX',
      receiptUrl: 'https://sandbox.asaas.com/comprovantes/1',
      checkoutUrl: 'https://app.fature.com.br/pagar/token123',
    };

    expect(renderInvoicePaidEmail(data).text).toContain(
      'Ver comprovante: https://sandbox.asaas.com/comprovantes/1',
    );
    expect(
      renderInvoicePaidEmail({ ...data, receiptUrl: null }).text,
    ).toContain('Ver fatura: https://app.fature.com.br/pagar/token123');
  });

  describe('manual payment', () => {
    it('asks the company to review the proof, with the value of today', () => {
      const email = renderPaymentProofReceivedEmail({
        brand: fatureBrand(),
        clientName: 'Maria <script>',
        description: 'Mensalidade',
        methodLabel: 'Transferência bancária',
        amountToday: 450,
        received: 300,
        dueDate: '2026-10-30',
        invoiceUrl: 'https://app.fature.com.br/faturas/inv-1',
      });

      expect(email.subject).toBe(
        'Comprovante recebido: fatura de Maria <script>',
      );
      expect(email.html).not.toContain('<script>');
      expect(email.text).toContain(
        'Forma de pagamento: Transferência bancária',
      );
      expect(email.text).toContain('Valor da fatura hoje: R$ 450,00');
      expect(email.text).toContain('Já recebido: R$ 300,00');
      expect(email.text).toContain(
        'Conferir comprovante: https://app.fature.com.br/faturas/inv-1',
      );
      expect(email.text).toContain('Comprovante falso é um golpe comum.');
    });

    it('omits what was received when it is the first proof', () => {
      const email = renderPaymentProofReceivedEmail({
        brand: fatureBrand(),
        clientName: 'Maria',
        description: null,
        methodLabel: 'PIX',
        amountToday: 450,
        received: 0,
        dueDate: '2026-10-30',
        invoiceUrl: 'https://app.fature.com.br/faturas/inv-1',
      });

      expect(email.text).not.toContain('Já recebido');
    });

    it('tells the payer why the proof was rejected', () => {
      const email = renderPaymentProofRejectedEmail({
        payer,
        clientName: 'Maria',
        description: null,
        reason: 'O valor do comprovante é diferente do valor da fatura',
        checkoutUrl: 'https://app.fature.com.br/pagar/token123',
      });

      expect(email.subject).toBe(
        'Comprovante não aceito: fatura de Raipp <Studio>',
      );
      expect(email.text).toContain(
        'Motivo: O valor do comprovante é diferente do valor da fatura',
      );
      expect(email.text).toContain(
        'Enviar outro comprovante: https://app.fature.com.br/pagar/token123',
      );
      expect(email.text).toContain(
        'Dúvidas? Responda este e-mail para falar com Raipp <Studio>.',
      );
    });

    it('shows the payer what was received and the balance of today', () => {
      const email = renderInvoicePartiallyPaidEmail({
        payer,
        clientName: 'Maria',
        description: null,
        amount: 100,
        received: 400,
        balance: 50,
        checkoutUrl: 'https://app.fature.com.br/pagar/token123',
      });

      expect(email.subject).toBe(
        'Pagamento parcial recebido: fatura de Raipp <Studio>',
      );
      expect(email.text).toContain('Valor recebido: R$ 100,00');
      expect(email.text).toContain('Total recebido: R$ 400,00');
      expect(email.text).toContain('Falta pagar hoje: R$ 50,00');
      expect(email.text).toContain(
        'Pagar o restante: https://app.fature.com.br/pagar/token123',
      );
    });
  });

  it('renders the quote totals', () => {
    const email = renderQuoteEmail({
      payer,
      clientName: null,
      description: null,
      items: [{ name: 'Site', quantity: 1, total: 1000 }],
      subtotal: 1000,
      itemsDiscount: 100,
      total: 900,
      dueDate: null,
    });

    expect(email.subject).toBe('Orçamento de Raipp <Studio>');
    expect(email.text).toContain('Descontos: - R$ 100,00');
    expect(email.text).toContain('Total: R$ 900,00');
    expect(email.text).toContain('O orçamento completo segue em PDF anexo');
    expect(email.text).toContain(
      'Para aprovar ou tirar dúvidas, responda este e-mail.',
    );
  });

  it('renders the Fature emails with their links', () => {
    expect(
      renderEmailVerificationEmail({
        name: 'Ana',
        url: 'https://api.fature.com.br/api/auth/verify-email?token=t',
      }).text,
    ).toContain(
      'Confirmar e-mail: https://api.fature.com.br/api/auth/verify-email?token=t',
    );
    expect(
      renderPasswordResetEmail({
        name: 'Ana',
        url: 'https://app.fature.com.br/redefinir-senha?token=t',
        expiresInMinutes: 60,
      }).text,
    ).toContain('O link vale por 60 minutos.');

    const invitation = renderOrganizationInvitationEmail({
      inviterName: 'Ana',
      organizationName: 'Raipp',
      role: 'admin',
      url: 'https://app.fature.com.br/convite/inv-1',
      expiresAt: new Date('2026-10-25T15:00:00Z'),
    });

    expect(invitation.subject).toBe('Ana convidou você para Raipp no Fature');
    expect(invitation.text).toContain('como administrador');
    expect(invitation.text).toContain('O convite vale até 25/10/2026.');
    expect(invitation.html).toContain(
      'src="https://app.fature.com.br/logo.png"',
    );
  });
});
