import {
  fatureSender,
  organizationSender,
  sanitizeDisplayName,
  sanitizeSubject,
} from './sender.js';

describe('sender', () => {
  beforeEach(() => {
    vi.stubEnv('EMAIL_FROM', 'cobrancas@mail.fature.com.br');
    vi.stubEnv('EMAIL_FROM_NAME', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('sends payer emails on behalf of the organization', () => {
    expect(organizationSender('Raipp Studio')).toBe(
      '"Raipp Studio via Fature" <cobrancas@mail.fature.com.br>',
    );
  });

  it('strips quotes, angle brackets and line breaks from the display name', () => {
    expect(sanitizeDisplayName('Ev"il <x@y.com>\r\nBcc: a@b.com')).toBe(
      'Evil x@y.comBcc: a@b.com',
    );
    expect(organizationSender('"\r\n')).toBe(
      '"Fature" <cobrancas@mail.fature.com.br>',
    );
  });

  it('keeps the "via Fature" suffix for long names', () => {
    const sender = organizationSender('A'.repeat(100));

    expect(sender).toMatch(/^"A+ via Fature" </);
    expect(sender.split('"')[1]).toHaveLength(60);
  });

  it('uses the configured name for Fature emails', () => {
    vi.stubEnv('EMAIL_FROM_NAME', 'Equipe Fature');

    expect(fatureSender()).toBe(
      '"Equipe Fature" <cobrancas@mail.fature.com.br>',
    );
  });

  it('keeps the subject on a single line', () => {
    expect(sanitizeSubject(' Fatura\r\nBcc: x ')).toBe('Fatura Bcc: x');
  });
});
