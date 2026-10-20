import { BadRequestException } from '@nestjs/common';
import { PayloadValidationPipe } from '../../common/pipes/payload-validation.pipe.js';
import { CreateClientDto } from './create-client.dto.js';
import { UpdateClientDto } from './update-client.dto.js';

/** Payload do formulário de cliente do fature-fe, aqui com máscaras e espaços. */
function clientPayload(): Record<string, any> {
  return {
    name: ' Maria da Silva ',
    email: ' Maria@Exemplo.com ',
    phone: '(11) 3333-4444',
    mobile: '',
    cpfCnpj: '529.982.247-25',
    municipalInscription: '',
    stateInscription: '',
    cep: '01001-000',
    addressLine: 'Praça da Sé',
    addressNumber: '1',
    complement: '',
    district: 'Sé',
    state: 'sp',
    city: 'São Paulo',
  };
}

type ClientDtoClass = typeof CreateClientDto | typeof UpdateClientDto;

const validate = (
  payload: unknown,
  metatype: ClientDtoClass = CreateClientDto,
) => PayloadValidationPipe.transform(payload, { type: 'body', metatype });

async function messagesOf(
  payload: unknown,
  metatype: ClientDtoClass = CreateClientDto,
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

describe('CreateClientDto', () => {
  it('normalizes the form payload: digits, lowercase email and empty as null', async () => {
    const dto: CreateClientDto = await validate(clientPayload());

    expect(dto).toMatchObject({
      name: 'Maria da Silva',
      email: 'maria@exemplo.com',
      phone: '1133334444',
      mobile: null,
      cpfCnpj: '52998224725',
      municipalInscription: null,
      cep: '01001000',
      complement: null,
      state: 'SP',
    });
  });

  it('drops the organization, the provider metadata and fields outside the contract', async () => {
    const dto = await validate({
      ...clientPayload(),
      organizationId: 'org-2',
      metadata: { asaas: { id: 'cus_1' } },
      deletedAt: null,
      invoices: { deleteMany: {} },
    });

    expect(dto).not.toHaveProperty('organizationId');
    expect(dto).not.toHaveProperty('metadata');
    expect(dto).not.toHaveProperty('deletedAt');
    expect(dto).not.toHaveProperty('invoices');
  });

  it('accepts just the name', async () => {
    await expect(validate({ name: 'Maria' })).resolves.toBeInstanceOf(
      CreateClientDto,
    );
  });

  it('requires the name', async () => {
    await expect(messagesOf({ name: '   ' })).resolves.toEqual([
      'Informe o nome do cliente',
    ]);
  });

  it('rejects an invalid email, document, phone, CEP and UF', async () => {
    const messages = await messagesOf({
      ...clientPayload(),
      email: 'maria@',
      cpfCnpj: '529.982.247-26',
      phone: '3333-4444',
      mobile: '(11) 9999',
      cep: '0100',
      state: 'São Paulo',
    });

    expect(messages).toEqual(
      expect.arrayContaining([
        'E-mail inválido',
        'CPF/CNPJ inválido',
        'Telefone inválido: informe DDD e número',
        'Celular inválido: informe DDD e número',
        'CEP inválido: informe os 8 dígitos',
        'UF inválida: use a sigla do estado (ex.: SP)',
      ]),
    );
  });
});

describe('UpdateClientDto', () => {
  it('accepts a partial payload and clears optional fields with null', async () => {
    const dto: UpdateClientDto = await validate(
      { email: null, phone: '' },
      UpdateClientDto,
    );

    expect(dto).toEqual({ email: null, phone: null });
  });

  it('does not clear the name', async () => {
    await expect(messagesOf({ name: null }, UpdateClientDto)).resolves.toEqual(
      expect.arrayContaining(['Informe o nome do cliente']),
    );
  });
});
