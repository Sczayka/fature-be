import { isEmail } from 'class-validator';
import type { PixKeyType } from '../../suppliers/suppliers.constants.js';
import { isValidCnpj, isValidCpf } from './cpf-cnpj.js';

/** Limite do DICT para chaves de e-mail. */
const EMAIL_KEY_MAX_LENGTH = 77;

/** Celular no formato do DICT: +55, DDD e os 9 dígitos do número. */
const PHONE_KEY_PATTERN = /^\+55[1-9]{2}9\d{8}$/;

/** Chave aleatória: um UUID. */
const EVP_KEY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Chave como o DICT a registra: documentos só com dígitos, e-mail e chave aleatória em minúsculas
 * e celular com +55 ("(11) 98888-7777" vira "+5511988887777"). O que não dá para converter volta
 * como veio, para a validação recusar.
 */
export function normalizePixKey(type: PixKeyType, key: string): string {
  const trimmed = key.trim();

  switch (type) {
    case 'CPF':
    case 'CNPJ':
      return trimmed.replace(/[\s./-]/g, '');
    case 'EMAIL':
    case 'EVP':
      return trimmed.toLowerCase();
    case 'PHONE': {
      const digits = trimmed.replace(/[\s()+-]/g, '');

      if (/^\d{11}$/.test(digits)) return `+55${digits}`;
      if (/^55\d{11}$/.test(digits)) return `+${digits}`;

      return trimmed;
    }
  }
}

/** Confere a chave já normalizada (normalizePixKey) contra o formato do tipo. */
export function isValidPixKey(type: PixKeyType, key: string): boolean {
  switch (type) {
    case 'CPF':
      return isValidCpf(key);
    case 'CNPJ':
      return isValidCnpj(key);
    case 'EMAIL':
      return key.length <= EMAIL_KEY_MAX_LENGTH && isEmail(key);
    case 'PHONE':
      return PHONE_KEY_PATTERN.test(key);
    case 'EVP':
      return EVP_KEY_PATTERN.test(key);
  }
}
