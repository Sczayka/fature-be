import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';

/** Cifra as credenciais dos provedores gravadas em PaymentGatewayAccount.metadata (AES-256-GCM). */
@Injectable()
export class CredentialsCipher {
  private readonly key: Buffer;

  constructor() {
    const secret = process.env.PAYMENT_GATEWAY_ENCRYPTION_KEY;

    if (!secret) {
      throw new Error('PAYMENT_GATEWAY_ENCRYPTION_KEY não configurada no .env');
    }

    // Mesma derivação usada desde a primeira versão: credenciais já gravadas continuam legíveis
    this.key = Buffer.from(secret, 'utf-8').subarray(0, 32);

    if (this.key.length !== 32) {
      throw new Error(
        'PAYMENT_GATEWAY_ENCRYPTION_KEY deve ter ao menos 32 bytes',
      );
    }
  }

  encrypt(value: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = cipher.update(value, 'utf8', 'hex') + cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');

    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  }

  decrypt(value: string): string {
    const [ivHex, authTagHex, encrypted] = value.split(':');
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      this.key,
      Buffer.from(ivHex, 'hex'),
    );

    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));

    return decipher.update(encrypted, 'hex', 'utf8') + decipher.final('utf8');
  }
}
