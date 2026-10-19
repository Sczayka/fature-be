import { isValidPixKey, normalizePixKey } from './pix-key.js';

describe('pix-key', () => {
  it('stores documents with digits only', () => {
    expect(normalizePixKey('CPF', ' 529.982.247-25 ')).toBe('52998224725');
    expect(normalizePixKey('CNPJ', '11.222.333/0001-81')).toBe(
      '11222333000181',
    );
  });

  it('stores the mobile number with the country code', () => {
    expect(normalizePixKey('PHONE', '(11) 98888-7777')).toBe('+5511988887777');
    expect(normalizePixKey('PHONE', '+55 11 98888-7777')).toBe(
      '+5511988887777',
    );
    expect(normalizePixKey('PHONE', 'telefone')).toBe('telefone');
  });

  it('stores email and random keys in lowercase', () => {
    expect(normalizePixKey('EMAIL', ' Financeiro@Fornecedor.com.br ')).toBe(
      'financeiro@fornecedor.com.br',
    );
    expect(normalizePixKey('EVP', '123E4567-E89B-12D3-A456-426614174000')).toBe(
      '123e4567-e89b-12d3-a456-426614174000',
    );
  });

  it('checks each key against its type', () => {
    expect(isValidPixKey('CPF', '52998224725')).toBe(true);
    expect(isValidPixKey('CPF', '52998224724')).toBe(false);
    expect(isValidPixKey('CNPJ', '11222333000181')).toBe(true);
    expect(isValidPixKey('CNPJ', '52998224725')).toBe(false);
    expect(isValidPixKey('EMAIL', 'financeiro@fornecedor.com.br')).toBe(true);
    expect(isValidPixKey('EMAIL', 'financeiro@')).toBe(false);
    expect(isValidPixKey('EMAIL', `${'a'.repeat(70)}@fornecedor.com`)).toBe(
      false,
    );
    expect(isValidPixKey('PHONE', '+5511988887777')).toBe(true);
    expect(isValidPixKey('PHONE', '+551133334444')).toBe(false);
    expect(isValidPixKey('PHONE', '11988887777')).toBe(false);
    expect(isValidPixKey('EVP', '123e4567-e89b-12d3-a456-426614174000')).toBe(
      true,
    );
    expect(isValidPixKey('EVP', '123e4567')).toBe(false);
  });
});
