import { BadRequestException } from '@nestjs/common';
import { PayloadValidationPipe } from '../../common/pipes/payload-validation.pipe.js';
import { CreateSupplierDto } from './create-supplier.dto.js';
import { UpdateSupplierDto } from './update-supplier.dto.js';

/** Payload do formulário de fornecedor do fature-fe. */
function supplierPayload(): Record<string, any> {
  return {
    name: ' Distribuidora Alfa Ltda ',
    tradeName: 'Alfa',
    email: ' Compras@Alfa.com.br ',
    phone: '(11) 3333-4444',
    mobile: '',
    cpfCnpj: '11.222.333/0001-81',
    municipalInscription: '',
    stateInscription: '123456789',
    cep: '01001-000',
    addressLine: 'Praça da Sé',
    addressNumber: '1',
    complement: '',
    district: 'Sé',
    state: 'sp',
    city: 'São Paulo',
    paymentTermDays: [30, 60, 90],
    notes: '',
    brandIds: ['brand-1', 'brand-2'],
    contacts: [
      {
        name: 'Ana',
        role: 'Vendas',
        email: 'ana@alfa.com.br',
        phone: '',
        mobile: '(11) 98888-7777',
        isMain: true,
      },
    ],
    bankAccounts: [
      {
        bankCode: '001',
        bankName: 'Banco do Brasil',
        branch: '1234-5',
        accountNumber: '12345-x',
        accountType: 'CHECKING',
        holderName: '',
        holderDocument: '',
        pixKeyType: 'PHONE',
        pixKey: '(11) 98888-7777',
        isMain: true,
      },
    ],
  };
}

type SupplierDtoClass = typeof CreateSupplierDto | typeof UpdateSupplierDto;

const validate = (
  payload: unknown,
  metatype: SupplierDtoClass = CreateSupplierDto,
) => PayloadValidationPipe.transform(payload, { type: 'body', metatype });

async function messagesOf(
  payload: unknown,
  metatype: SupplierDtoClass = CreateSupplierDto,
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

describe('CreateSupplierDto', () => {
  it('normalizes the form payload: digits, lowercase email and empty as null', async () => {
    const dto: CreateSupplierDto = await validate(supplierPayload());

    expect(dto).toMatchObject({
      name: 'Distribuidora Alfa Ltda',
      email: 'compras@alfa.com.br',
      phone: '1133334444',
      mobile: null,
      cpfCnpj: '11222333000181',
      municipalInscription: null,
      cep: '01001000',
      state: 'SP',
      notes: null,
      paymentTermDays: [30, 60, 90],
    });
    expect(dto.contacts?.[0]).toMatchObject({
      phone: null,
      mobile: '11988887777',
      isMain: true,
    });
    expect(dto.bankAccounts?.[0]).toMatchObject({
      accountNumber: '12345-X',
      holderName: null,
      holderDocument: null,
      pixKey: '+5511988887777',
    });
  });

  it('drops the organization and fields outside the contract', async () => {
    const dto = await validate({
      ...supplierPayload(),
      organizationId: 'org-2',
      items: { deleteMany: {} },
    });

    expect(dto).not.toHaveProperty('organizationId');
    expect(dto).not.toHaveProperty('items');
  });

  it('accepts just the name', async () => {
    await expect(validate({ name: 'Fornecedor' })).resolves.toBeInstanceOf(
      CreateSupplierDto,
    );
  });

  it('rejects an invalid document, phone, CEP and UF', async () => {
    const messages = await messagesOf({
      ...supplierPayload(),
      cpfCnpj: '11.222.333/0001-82',
      phone: '3333-4444',
      cep: '0100',
      state: 'São Paulo',
    });

    expect(messages).toEqual(
      expect.arrayContaining([
        'CPF/CNPJ inválido',
        'Telefone inválido: informe DDD e número',
        'CEP inválido: informe os 8 dígitos',
        'UF inválida: use a sigla do estado (ex.: SP)',
      ]),
    );
  });

  it('explains what is wrong with the payment term', async () => {
    await expect(
      messagesOf({ ...supplierPayload(), paymentTermDays: [60, 30] }),
    ).resolves.toEqual([
      'As parcelas do prazo de pagamento devem estar em ordem crescente, sem repetir dias',
    ]);
    await expect(
      messagesOf({ ...supplierPayload(), paymentTermDays: [400] }),
    ).resolves.toEqual([
      'Cada parcela deve vencer de 0 a 365 dias após a compra',
    ]);
    await expect(
      messagesOf({ ...supplierPayload(), paymentTermDays: null }),
    ).resolves.toEqual(['Informe o prazo de pagamento como uma lista de dias']);
  });

  it('rejects repeated brands', async () => {
    await expect(
      messagesOf({ ...supplierPayload(), brandIds: ['brand-1', 'brand-1'] }),
    ).resolves.toEqual(['A mesma marca aparece mais de uma vez']);
  });

  it('requires the name of each contact and validates its email', async () => {
    const messages = await messagesOf({
      ...supplierPayload(),
      contacts: [{ name: '', email: 'ana@' }],
    });

    expect(messages).toEqual(
      expect.arrayContaining([
        'contacts.0.Informe o nome do contato',
        'contacts.0.E-mail do contato inválido',
      ]),
    );
  });

  describe('bank accounts', () => {
    const account = (data: Record<string, unknown>) => ({
      ...supplierPayload(),
      bankAccounts: [data],
    });

    it('accepts only the Pix key', async () => {
      const dto: CreateSupplierDto = await validate(
        account({ pixKeyType: 'EMAIL', pixKey: ' Financeiro@Alfa.com.br ' }),
      );

      expect(dto.bankAccounts?.[0].pixKey).toBe('financeiro@alfa.com.br');
    });

    it('accepts only the transfer data', async () => {
      await expect(
        messagesOf(
          account({
            bankCode: '341',
            branch: '0001',
            accountNumber: '123456',
            accountType: 'SAVINGS',
          }),
        ),
      ).resolves.toEqual([]);
    });

    it('requires bank, branch, account and type together', async () => {
      const messages = await messagesOf(account({ bankCode: '341' }));

      expect(messages).toEqual([
        'bankAccounts.0.Informe a agência: só números, com o dígito depois do hífen',
        'bankAccounts.0.Informe a conta com o dígito: só números, com o dígito depois do hífen',
        'bankAccounts.0.Informe o tipo da conta: corrente (CHECKING) ou poupança (SAVINGS)',
      ]);
    });

    it('requires a Pix key valid for its type', async () => {
      await expect(
        messagesOf(account({ pixKeyType: 'CPF', pixKey: '529.982.247-24' })),
      ).resolves.toEqual([
        'bankAccounts.0.Informe uma chave Pix válida para o tipo escolhido',
      ]);
      await expect(messagesOf(account({ pixKeyType: 'EVP' }))).resolves.toEqual(
        ['bankAccounts.0.Informe uma chave Pix válida para o tipo escolhido'],
      );
    });

    it('validates the holder document', async () => {
      await expect(
        messagesOf(
          account({
            pixKeyType: 'EVP',
            pixKey: '123e4567-e89b-12d3-a456-426614174000',
            holderDocument: '123',
          }),
        ),
      ).resolves.toEqual(['bankAccounts.0.CPF/CNPJ do titular inválido']);
    });
  });
});

describe('UpdateSupplierDto', () => {
  it('keeps only the fields that were sent', async () => {
    await expect(
      validate({ active: false }, UpdateSupplierDto),
    ).resolves.toEqual({ active: false });
  });

  it('clears optional fields with null and rejects null in the required ones', async () => {
    await expect(
      validate({ cpfCnpj: null, tradeName: null }, UpdateSupplierDto),
    ).resolves.toEqual({ cpfCnpj: null, tradeName: null });

    const messages = await messagesOf(
      { name: null, contacts: null, brandIds: null },
      UpdateSupplierDto,
    );

    expect(messages).toEqual(
      expect.arrayContaining([
        'Informe o nome ou a razão social',
        'Envie os contatos em uma lista',
        'Envie as marcas em uma lista',
      ]),
    );
  });
});
