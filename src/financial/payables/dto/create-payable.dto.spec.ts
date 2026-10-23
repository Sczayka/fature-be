import { BadRequestException } from '@nestjs/common';
import { PayloadValidationPipe } from '../../../common/pipes/payload-validation.pipe.js';
import { CreatePayableDto } from './create-payable.dto.js';
import { UpdatePayableDto } from './update-payable.dto.js';

/** Payload do formulário de conta a pagar do fature-fe. */
function payablePayload(): Record<string, any> {
  return {
    description: ' Compra de mercadorias ',
    supplierId: 'supplier-1',
    supplierBankAccountId: '',
    employeeId: '',
    payrollType: '',
    competence: '',
    categoryId: 'cat-1',
    documentNumber: ' NF 123 ',
    paymentMethod: 'BANK_SLIP',
    accountId: '',
    notes: '',
    installments: [{ dueDate: '2026-11-05', amount: 1500.5 }],
  };
}

type PayableDtoClass = typeof CreatePayableDto | typeof UpdatePayableDto;

const validate = (
  payload: unknown,
  metatype: PayableDtoClass = CreatePayableDto,
) => PayloadValidationPipe.transform(payload, { type: 'body', metatype });

async function messagesOf(
  payload: unknown,
  metatype: PayableDtoClass = CreatePayableDto,
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

describe('CreatePayableDto', () => {
  it('normalizes the form payload: trimmed texts and empty as null', async () => {
    const dto: CreatePayableDto = await validate(payablePayload());

    expect(dto).toMatchObject({
      description: 'Compra de mercadorias',
      supplierBankAccountId: null,
      employeeId: null,
      payrollType: null,
      competence: null,
      documentNumber: 'NF 123',
      accountId: null,
      notes: null,
      installments: [{ dueDate: '2026-11-05', amount: 1500.5 }],
    });
  });

  it('requires the type of the series with more than one due date', async () => {
    const installments = [
      { dueDate: '2026-11-05', amount: 500 },
      { dueDate: '2026-12-05', amount: 500 },
    ];

    await expect(
      messagesOf({ ...payablePayload(), installments }),
    ).resolves.toEqual([
      'Informe se são parcelas (INSTALLMENTS) ou recorrência mensal (RECURRING)',
    ]);
    await expect(
      messagesOf({
        ...payablePayload(),
        installments,
        seriesType: 'RECURRING',
      }),
    ).resolves.toEqual([]);
  });

  it('limits the series to 60 due dates and validates each one', async () => {
    const installments = Array.from({ length: 61 }, () => ({
      dueDate: '2026-11-05',
      amount: 10,
    }));

    await expect(
      messagesOf({
        ...payablePayload(),
        installments,
        seriesType: 'RECURRING',
      }),
    ).resolves.toEqual(['A série vai até 60 vencimentos']);

    const messages = await messagesOf({
      ...payablePayload(),
      installments: [{ dueDate: '05/11/2026', amount: 0 }],
    });

    expect(messages).toEqual(
      expect.arrayContaining([
        'installments.0.Informe o vencimento no formato YYYY-MM-DD',
        'installments.0.O valor deve ser maior que zero',
      ]),
    );
  });

  it('requires the payroll fields with an employee', async () => {
    const messages = await messagesOf({
      ...payablePayload(),
      supplierId: '',
      employeeId: 'employee-1',
      payrollType: 'BONUS',
      competence: '2026-13',
    });

    expect(messages).toEqual([
      'Informe o mês de referência no formato YYYY-MM',
    ]);
  });

  it('validates the payment of a payable already paid', async () => {
    const messages = await messagesOf({
      ...payablePayload(),
      payment: { paymentDate: '2026-10-20', accountId: '', paidAmount: 10.123 },
    });

    expect(messages).toEqual(
      expect.arrayContaining([
        'payment.Escolha a conta de onde saiu o dinheiro',
        'payment.O valor pago deve ser um número com até 2 casas decimais',
      ]),
    );
  });
});

describe('UpdatePayableDto', () => {
  it('keeps only the fields that were sent and rejects null in the required ones', async () => {
    await expect(validate({ amount: 2100 }, UpdatePayableDto)).resolves.toEqual(
      { amount: 2100 },
    );

    const messages = await messagesOf(
      { description: null, amount: null, dueDate: null },
      UpdatePayableDto,
    );

    expect(messages).toEqual(
      expect.arrayContaining([
        'Informe a descrição',
        'O valor deve ser um número com até 2 casas decimais',
        'Informe o vencimento no formato YYYY-MM-DD',
      ]),
    );
  });
});
