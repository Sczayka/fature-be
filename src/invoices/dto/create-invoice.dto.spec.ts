import { BadRequestException } from '@nestjs/common';
import { PayloadValidationPipe } from '../../common/pipes/payload-validation.pipe.js';
import { CreateInvoiceDto } from './create-invoice.dto.js';

/** Payload de referência enviado pelo fature-fe. */
function referencePayload(): Record<string, any> {
  return {
    client: {
      id: 'cmucqdm5u0001r8m90nyeqxla',
      name: 'Ryan Sczayka Nunes',
      email: 'ryan_sczayka@hotmail.com',
      phone: '',
      mobile: '11970518719',
      cpfCnpj: '49398804867',
      municipalInscription: '',
      stateInscription: '',
      cep: '08340000',
      addressLine: 'Avenida Ragueb Chohfi',
      addressNumber: '1835',
      complement: 'Ap 21 B 10',
      district: 'Parque São Lourenço',
      state: 'SP',
      city: 'São Paulo',
      createdAt: '2026-09-22T13:49:39.570Z',
      updatedAt: '2026-09-22T13:49:39.570Z',
    },
    items: [
      {
        item: {
          id: 'cmv6w3nab0000v0m9fogo3rgu',
          name: 'Produto teste',
          type: 'product',
          price: 100,
        },
        quantity: 1,
        total: 100,
      },
    ],
    billing: {
      dueDate: '2026-10-31',
      referenceDate: '2026-10-31',
      description: 'Descricao teste',
    },
    paymentMethods: ['BANK_SLIP', 'CREDIT_CARD', 'DEBIT_CARD', 'PIX'],
    discount: {
      items: [
        {
          id: 'cmv6w3nab0000v0m9fogo3rgu',
          type: 'PERCENTAGE',
          value: 1,
          limitDate: '2026-10-30',
        },
      ],
      methods: [
        {
          method: 'BANK_SLIP',
          type: 'PERCENTAGE',
          value: 1,
          limitDate: '2026-10-30',
        },
      ],
    },
    interestAndFine: {
      fineType: 'PERCENTAGE',
      fineValue: 1,
      interestType: 'PERCENTAGE',
      interestValue: 1,
    },
  };
}

const validate = (payload: unknown) =>
  PayloadValidationPipe.transform(payload, {
    type: 'body',
    metatype: CreateInvoiceDto,
  });

async function validationMessages(payload: unknown): Promise<string[]> {
  try {
    await validate(payload);
    return [];
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    return (
      (error as BadRequestException).getResponse() as { message: string[] }
    ).message;
  }
}

describe('CreateInvoiceDto', () => {
  it('accepts the reference payload and strips fields outside the contract', async () => {
    const dto: CreateInvoiceDto = await validate(referencePayload());

    expect(dto).toBeInstanceOf(CreateInvoiceDto);
    expect(dto.client.id).toBe('cmucqdm5u0001r8m90nyeqxla');
    expect(dto.client).not.toHaveProperty('createdAt');
    expect(dto.items[0].item.type).toBe('product');
    // Item discounts have no deadline: a limitDate sent by older clients is discarded
    expect(dto.discount?.items[0]).not.toHaveProperty('limitDate');
    expect(dto.discount?.methods[0].limitDate).toBe('2026-10-30');
  });

  it('applies defaults to the optional sections', async () => {
    const payload = referencePayload();
    delete payload.discount;
    delete payload.interestAndFine;
    payload.discount = { items: [] };

    const dto: CreateInvoiceDto = await validate(payload);

    expect(dto.discount?.methods).toEqual([]);
    expect(dto.interestAndFine).toBeUndefined();
  });

  it('rejects the old payload format', async () => {
    const messages = await validationMessages({
      clientId: 'client-1',
      items: [
        { id: 'item-1', name: 'Item', price: 10, quantity: 1, total: 10 },
      ],
      totalValue: 10,
      dueDate: '2026-10-31',
      paymentMethods: { bankSlip: {} },
    });

    expect(messages.length).toBeGreaterThan(0);
  });

  it('rejects invalid dates, payment methods and percentages over 100', async () => {
    const payload = referencePayload();
    payload.billing.dueDate = '2026-02-30';
    payload.paymentMethods = ['BOLETO'];
    payload.interestAndFine.fineValue = 150;

    const messages = await validationMessages(payload);

    expect(messages).toEqual(
      expect.arrayContaining([
        'billing.dueDate deve ser uma data válida',
        expect.stringContaining('paymentMethods'),
        'interestAndFine.fineValue não pode ser maior que 100%',
      ]),
    );
  });

  it('requires items and payment methods', async () => {
    const payload = referencePayload();
    payload.items = [];
    payload.paymentMethods = [];

    const messages = await validationMessages(payload);

    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringContaining('items'),
        expect.stringContaining('paymentMethods'),
      ]),
    );
  });
});
