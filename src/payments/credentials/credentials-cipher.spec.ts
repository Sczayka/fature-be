import * as crypto from 'crypto';
import { CredentialsCipher } from './credentials-cipher.js';

const SECRET = 'chave-de-teste-com-pelo-menos-32-bytes';

describe('CredentialsCipher', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('decrypts what it encrypts', () => {
    vi.stubEnv('PAYMENT_GATEWAY_ENCRYPTION_KEY', SECRET);
    const cipher = new CredentialsCipher();

    const encrypted = cipher.encrypt('api-key');

    expect(encrypted).not.toContain('api-key');
    expect(cipher.decrypt(encrypted)).toBe('api-key');
  });

  it('reads credentials stored before the payments module (same key derivation)', () => {
    vi.stubEnv('PAYMENT_GATEWAY_ENCRYPTION_KEY', SECRET);

    // Formato e derivação do antigo AsaasService.encryptApiKey
    const iv = crypto.randomBytes(16);
    const legacy = crypto.createCipheriv(
      'aes-256-gcm',
      Buffer.from(SECRET, 'utf-8').subarray(0, 32),
      iv,
    );
    const encrypted =
      legacy.update('legacy-key', 'utf8', 'hex') + legacy.final('hex');
    const stored = `${iv.toString('hex')}:${legacy.getAuthTag().toString('hex')}:${encrypted}`;

    expect(new CredentialsCipher().decrypt(stored)).toBe('legacy-key');
  });

  it('refuses to start without the key in the environment', () => {
    vi.stubEnv('PAYMENT_GATEWAY_ENCRYPTION_KEY', '');

    expect(() => new CredentialsCipher()).toThrow(
      'PAYMENT_GATEWAY_ENCRYPTION_KEY',
    );
  });

  it('refuses a key shorter than 32 bytes', () => {
    vi.stubEnv('PAYMENT_GATEWAY_ENCRYPTION_KEY', 'curta');

    expect(() => new CredentialsCipher()).toThrow('32 bytes');
  });
});
