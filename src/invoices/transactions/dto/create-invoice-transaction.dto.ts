import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  ValidateBy,
  type ValidationArguments,
} from 'class-validator';
import { queryBoolean, trimToNull } from '../../../common/dto/transforms.js';
import {
  MANUAL_PAYMENT_METHODS,
  type ManualPaymentMethod,
} from '../../../payments/manual/manual-payments.constants.js';
import {
  REFUND_METHODS,
  TRANSACTION_TYPE,
  type RefundMethod,
  type TransactionType,
} from '../../../payments/transactions/transactions.constants.js';
import { IsDateOnly } from '../../dto/invoice-sections.dto.js';

const TRANSACTION_TYPES: TransactionType[] = Object.values(TRANSACTION_TYPE);

const isPaymentOf = (args?: ValidationArguments) =>
  (args?.object as Partial<CreateInvoiceTransactionDto> | undefined)?.type ===
  TRANSACTION_TYPE.PAYMENT;

/** Pagamento nas formas manuais; devolução nas formas em que ela é feita por fora. */
function IsMethodOfType() {
  return ValidateBy({
    name: 'isMethodOfType',
    validator: {
      validate: (value, args) => {
        const methods: readonly string[] = isPaymentOf(args)
          ? MANUAL_PAYMENT_METHODS
          : REFUND_METHODS;

        return typeof value === 'string' && methods.includes(value);
      },
      defaultMessage: (args) =>
        isPaymentOf(args)
          ? 'Forma de pagamento inválida: use PIX ou transferência bancária'
          : 'Forma de devolução inválida: use PIX ou transferência bancária',
    },
  });
}

/**
 * Transação lançada pela empresa (multipart, com o comprovante no campo `file`): pagamento
 * recebido por fora numa forma manual ou devolução do excedente.
 */
export class CreateInvoiceTransactionDto {
  @IsIn(TRANSACTION_TYPES, { message: 'Tipo de transação inválido' })
  type: TransactionType;

  @IsMethodOfType()
  method: ManualPaymentMethod | RefundMethod;

  @Type(() => Number)
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'O valor deve ter no máximo 2 casas decimais' },
  )
  @IsPositive({ message: 'O valor deve ser maior que zero' })
  amount: number;

  /** Data em que o dinheiro entrou ou saiu. */
  @IsDateOnly()
  occurredAt: string;

  /** ID E2E do PIX ou autenticação da TED. */
  @Transform(trimToNull)
  @IsOptional()
  @IsString({ message: 'A referência bancária deve ser um texto' })
  @MaxLength(64, {
    message: 'A referência bancária deve ter no máximo 64 caracteres',
  })
  bankReference?: string | null;

  /** Observação interna. */
  @Transform(trimToNull)
  @IsOptional()
  @IsString({ message: 'A observação deve ser um texto' })
  @MaxLength(500, { message: 'A observação deve ter no máximo 500 caracteres' })
  notes?: string | null;

  /**
   * Pagamento com o mesmo comprovante (ou a mesma referência) de outro já confirmado: o operador
   * confirma de novo depois do aviso DUPLICATE_PAYMENT_PROOF. Texto no multipart.
   */
  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean({ message: 'acknowledgeDuplicates deve ser true ou false' })
  acknowledgeDuplicates?: boolean;
}
