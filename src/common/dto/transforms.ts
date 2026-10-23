import type { TransformFnParams } from 'class-transformer';
import { isPixKeyType, normalizePixKey } from '../utils/pix-key.js';

/** Texto sem espaços nas pontas; outros tipos seguem como vieram para a validação recusar. */
export const trim = ({ value }: TransformFnParams) =>
  typeof value === 'string' ? value.trim() : value;

/** Texto opcional: sem espaços nas pontas, e vazio vira null (limpa o campo). */
export const trimToNull = ({ value }: TransformFnParams) =>
  typeof value === 'string' ? value.trim() || null : value;

/** E-mail opcional: minúsculo, sem espaços nas pontas, e vazio vira null. */
export const emailToNull = ({ value }: TransformFnParams) =>
  typeof value === 'string' ? value.trim().toLowerCase() || null : value;

/**
 * Documento, telefone ou CEP sem a pontuação ("529.982.247-25" vira "52998224725"), e vazio vira
 * null. Letras ficam, para a validação recusar.
 */
export const unmaskToNull = ({ value }: TransformFnParams) =>
  typeof value === 'string' ? value.replace(/[\s()./-]/g, '') || null : value;

/** UF opcional: maiúscula, sem espaços nas pontas, e vazio vira null. */
export const stateToNull = ({ value }: TransformFnParams) =>
  typeof value === 'string' ? value.trim().toUpperCase() || null : value;

/** Ids da query string, separados por vírgula ("a,b") ou repetidos (ids=a&ids=b). */
export const idList = ({ value }: TransformFnParams) => {
  const values: unknown[] = Array.isArray(value) ? value : [value];

  return values
    .flatMap((entry) => (typeof entry === 'string' ? entry.split(',') : []))
    .map((id) => id.trim())
    .filter(Boolean);
};

/** Booleano da query string: "true" e "false"; o resto segue para a validação recusar. */
export const queryBoolean = ({ value }: TransformFnParams) =>
  value === 'true' ? true : value === 'false' ? false : value;

/** Agência e conta: sem espaços e pontos, com o dígito X em maiúscula. */
export const accountToNull = ({ value }: TransformFnParams) =>
  typeof value === 'string'
    ? value.replace(/[\s.]/g, '').toUpperCase() || null
    : value;

/** Chave Pix no formato do DICT, conforme o tipo enviado junto (`pixKeyType`). */
export const pixKeyToNull = ({ value, obj }: TransformFnParams) => {
  if (typeof value !== 'string') return value;

  const key = isPixKeyType(obj.pixKeyType)
    ? normalizePixKey(obj.pixKeyType, value)
    : value.trim();

  return key || null;
};
