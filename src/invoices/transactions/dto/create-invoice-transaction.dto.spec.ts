import { BadRequestException } from '@nestjs/common';
import { PayloadValidationPipe } from '../../../common/pipes/payload-validation.pipe.js';
import { ConfirmInvoiceTransactionDto } from './confirm-invoice-transaction.dto.js';
import { CreateInvoiceTransactionDto } from './create-invoice-transaction.dto.js';

type TransactionDtoClass =
  typeof CreateInvoiceTransactionDto | typeof ConfirmInvoiceTransactionDto;

/** Campos do multipart: tudo chega como texto. */
const payment = {
  type: 'PAYMENT',
  method: 'PIX',
  amount: '150.5',
  occurredAt: '2026-10-15',
  bankReference: ' E2E123 ',
  notes: '',
};

const validate = (
  payload: unknown,
  metatype: TransactionDtoClass = CreateInvoiceTransactionDto,
) => PayloadValidationPipe.transform(payload, { type: 'body', metatype });

async function messagesOf(
  payload: unknown,
  metatype: TransactionDtoClass = CreateInvoiceTransactionDto,
): Promise<string[]> {
  try {
    await validate(payload, metatype);
    return [];
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    return (
      (error as BadRequestException).getResponse() as { message: string[] }
    ).message;
  }
}

describe('CreateInvoiceTransactionDto', () => {
  it('accepts a manual payment from the multipart form', async () => {
    await expect(
      validate({ ...payment, acknowledgeDuplicates: 'true' }),
    ).resolves.toEqual({
      type: 'PAYMENT',
      method: 'PIX',
      amount: 150.5,
      occurredAt: '2026-10-15',
      bankReference: 'E2E123',
      notes: null,
      acknowledgeDuplicates: true,
    });
  });

  it('accepts only the manual methods in a payment', async () => {
    await expect(
      messagesOf({ ...payment, method: 'CREDIT_CARD' }),
    ).resolves.toEqual([
      'Forma de pagamento inválida: use PIX ou transferência bancária',
    ]);
    await expect(
      messagesOf({ ...payment, type: 'REFUND', method: 'BANK_SLIP' }),
    ).resolves.toEqual([
      'Forma de devolução inválida: use PIX ou transferência bancária',
    ]);
  });

  it('rejects an unknown type and an invalid acknowledgement', async () => {
    await expect(
      messagesOf({
        ...payment,
        type: 'CHARGEBACK',
        acknowledgeDuplicates: 'sim',
      }),
    ).resolves.toEqual(
      expect.arrayContaining([
        'Tipo de transação inválido',
        'acknowledgeDuplicates deve ser true ou false',
      ]),
    );
  });
});

describe('ConfirmInvoiceTransactionDto', () => {
  it('keeps only the review fields, with the same rules', async () => {
    await expect(
      validate(
        {
          amount: 300,
          occurredAt: '2026-10-14',
          acknowledgeDuplicates: true,
          type: 'REFUND',
          method: 'BANK_SLIP',
        },
        ConfirmInvoiceTransactionDto,
      ),
    ).resolves.toEqual({
      amount: 300,
      occurredAt: '2026-10-14',
      acknowledgeDuplicates: true,
    });
    await expect(
      messagesOf(
        { amount: 0, occurredAt: '14/10/2026' },
        ConfirmInvoiceTransactionDto,
      ),
    ).resolves.toEqual(
      expect.arrayContaining(['O valor deve ser maior que zero']),
    );
  });
});
