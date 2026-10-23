import { applyDecorators } from '@nestjs/common';
import {
  IsIn,
  IsISO8601,
  IsNumber,
  IsPositive,
  IsString,
  Matches,
  Max,
  MaxLength,
} from 'class-validator';
import {
  COMPETENCE_PATTERN,
  ENTRY_PAYMENT_METHODS,
  FINANCIAL_AMOUNT_MAX,
  FINANCIAL_NOTES_MAX_LENGTH,
} from '../financial.constants.js';

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Dia sem horário (YYYY-MM-DD); `label` completa a mensagem (ex.: "a data do pagamento"). */
export function IsDay(label: string) {
  const message = `Informe ${label} no formato YYYY-MM-DD`;

  return applyDecorators(
    IsString({ message }),
    Matches(DAY_PATTERN, { message }),
    IsISO8601({ strict: true }, { message }),
  );
}

/** Valor em reais: positivo, com até 2 casas e dentro do que a coluna guarda. */
export function IsFinancialAmount(label = 'O valor') {
  return applyDecorators(
    IsNumber(
      { maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false },
      { message: `${label} deve ser um número com até 2 casas decimais` },
    ),
    IsPositive({ message: `${label} deve ser maior que zero` }),
    Max(FINANCIAL_AMOUNT_MAX, {
      message: `${label} deve ser de no máximo R$ 999.999.999,99`,
    }),
  );
}

/** Mês de referência da folha (YYYY-MM). */
export function IsCompetence() {
  return Matches(COMPETENCE_PATTERN, {
    message: 'Informe o mês de referência no formato YYYY-MM',
  });
}

export function IsEntryPaymentMethod() {
  return IsIn(ENTRY_PAYMENT_METHODS, {
    message: `Forma de pagamento inválida: use ${ENTRY_PAYMENT_METHODS.join(', ')}`,
  });
}

/** Observação interna, até 500 caracteres. */
export function IsFinancialNotes() {
  return applyDecorators(
    IsString({ message: 'A observação deve ser um texto' }),
    MaxLength(FINANCIAL_NOTES_MAX_LENGTH, {
      message: `A observação deve ter no máximo ${FINANCIAL_NOTES_MAX_LENGTH} caracteres`,
    }),
  );
}
