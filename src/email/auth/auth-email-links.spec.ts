import {
  invitationUrl,
  resetPasswordUrl,
  verificationUrl,
} from './auth-email-links.js';

describe('auth email links', () => {
  beforeEach(() => {
    vi.stubEnv('FRONTEND_URL', 'https://app.fature.com.br/');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('opens the reset form of the frontend with the token', () => {
    expect(resetPasswordUrl('abc+/=')).toBe(
      'https://app.fature.com.br/redefinir-senha?token=abc%2B%2F%3D',
    );
  });

  it('keeps the Better Auth link and returns to the confirmation page', () => {
    const url = new URL(
      verificationUrl(
        'https://api.fature.com.br/api/auth/verify-email?token=jwt&callbackURL=%2F',
      ),
    );

    expect(url.origin + url.pathname).toBe(
      'https://api.fature.com.br/api/auth/verify-email',
    );
    expect(url.searchParams.get('token')).toBe('jwt');
    expect(url.searchParams.get('callbackURL')).toBe(
      'https://app.fature.com.br/email-verificado',
    );
  });

  it('points the invitation to its page', () => {
    expect(invitationUrl('inv-1')).toBe(
      'https://app.fature.com.br/convite/inv-1',
    );
  });
});
