import { createEmailTransport } from './get-email-transport.js';

describe('createEmailTransport', () => {
  it('logs the emails when there is no Resend API key', () => {
    expect(createEmailTransport({}).name).toBe('console');
    expect(createEmailTransport({ RESEND_API_KEY: '  ' }).name).toBe('console');
  });

  it('sends through Resend when the API key is set', () => {
    expect(createEmailTransport({ RESEND_API_KEY: 're_test' }).name).toBe(
      'resend',
    );
  });

  it('redirects every email when EMAIL_REDIRECT_TO is set', () => {
    const transport = createEmailTransport({
      EMAIL_REDIRECT_TO: 'dev@fature.com.br',
    });

    expect(transport.name).toBe('console-redirect');
  });
});
