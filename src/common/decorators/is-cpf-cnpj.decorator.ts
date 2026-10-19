import { ValidateBy, type ValidationOptions } from 'class-validator';
import { isValidCpfCnpj } from '../utils/cpf-cnpj.js';

/** CPF (11) ou CNPJ (14) só com dígitos e com os dígitos verificadores corretos. */
export function IsCpfCnpj(validationOptions?: ValidationOptions) {
  return ValidateBy(
    {
      name: 'isCpfCnpj',
      validator: {
        validate: (value) => typeof value === 'string' && isValidCpfCnpj(value),
        defaultMessage: () => 'CPF/CNPJ inválido',
      },
    },
    validationOptions,
  );
}
