/**
 * CPF e CNPJ só com dígitos (11 ou 14), conferidos pelos dígitos verificadores. Sequências de um
 * mesmo dígito passam na conta, mas não são documentos válidos.
 */
export function isValidCpfCnpj(value: string): boolean {
  if (value.length === 11) return isValidCpf(value);
  if (value.length === 14) return isValidCnpj(value);

  return false;
}

export function isValidCpf(value: string): boolean {
  if (!/^\d{11}$/.test(value) || /^(\d)\1+$/.test(value)) return false;

  return (
    cpfCheckDigit(value.slice(0, 9)) === Number(value[9]) &&
    cpfCheckDigit(value.slice(0, 10)) === Number(value[10])
  );
}

export function isValidCnpj(value: string): boolean {
  if (!/^\d{14}$/.test(value) || /^(\d)\1+$/.test(value)) return false;

  return (
    cnpjCheckDigit(value.slice(0, 12)) === Number(value[12]) &&
    cnpjCheckDigit(value.slice(0, 13)) === Number(value[13])
  );
}

/** Pesos decrescentes até 2: de 10 no primeiro dígito verificador e de 11 no segundo. */
function cpfCheckDigit(base: string): number {
  const sum = [...base].reduce(
    (total, digit, index) => total + Number(digit) * (base.length + 1 - index),
    0,
  );

  return mod11CheckDigit(sum);
}

/** Pesos de 2 a 9, repetidos da direita para a esquerda. */
function cnpjCheckDigit(base: string): number {
  const sum = [...base]
    .reverse()
    .reduce(
      (total, digit, index) => total + Number(digit) * ((index % 8) + 2),
      0,
    );

  return mod11CheckDigit(sum);
}

function mod11CheckDigit(sum: number): number {
  const rest = sum % 11;

  return rest < 2 ? 0 : 11 - rest;
}
