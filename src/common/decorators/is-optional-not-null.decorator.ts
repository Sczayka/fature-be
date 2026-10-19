import { ValidateIf } from 'class-validator';

/**
 * Campo que pode faltar (ausente não muda nada), mas não aceita null: diferente de @IsOptional,
 * o null segue para a validação e é recusado. Para colunas obrigatórias no banco e listas
 * que só são substituídas.
 */
export function IsOptionalNotNull() {
  return ValidateIf((_object, value) => value !== undefined);
}
