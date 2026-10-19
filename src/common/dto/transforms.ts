import type { TransformFnParams } from 'class-transformer';

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

/** Booleano da query string: "true" e "false"; o resto segue para a validação recusar. */
export const queryBoolean = ({ value }: TransformFnParams) =>
  value === 'true' ? true : value === 'false' ? false : value;
