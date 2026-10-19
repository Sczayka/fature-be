import { isValidCnpj, isValidCpf, isValidCpfCnpj } from './cpf-cnpj.js';

describe('cpf-cnpj', () => {
  it('accepts CPFs with valid check digits', () => {
    expect(isValidCpf('52998224725')).toBe(true);
    expect(isValidCpf('12345678909')).toBe(true);
  });

  it('rejects CPFs with wrong check digits, repeated digits or punctuation', () => {
    expect(isValidCpf('52998224724')).toBe(false);
    expect(isValidCpf('52998224715')).toBe(false);
    expect(isValidCpf('11111111111')).toBe(false);
    expect(isValidCpf('529.982.247-25')).toBe(false);
    expect(isValidCpf('5299822472')).toBe(false);
  });

  it('accepts CNPJs with valid check digits', () => {
    expect(isValidCnpj('11222333000181')).toBe(true);
    expect(isValidCnpj('11444777000161')).toBe(true);
  });

  it('rejects CNPJs with wrong check digits, repeated digits or punctuation', () => {
    expect(isValidCnpj('11222333000182')).toBe(false);
    expect(isValidCnpj('11222333000191')).toBe(false);
    expect(isValidCnpj('00000000000000')).toBe(false);
    expect(isValidCnpj('11.222.333/0001-81')).toBe(false);
  });

  it('picks the document by length', () => {
    expect(isValidCpfCnpj('52998224725')).toBe(true);
    expect(isValidCpfCnpj('11222333000181')).toBe(true);
    expect(isValidCpfCnpj('529982247251')).toBe(false);
    expect(isValidCpfCnpj('')).toBe(false);
  });
});
