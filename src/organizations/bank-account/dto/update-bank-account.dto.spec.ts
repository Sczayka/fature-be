import { BadRequestException } from '@nestjs/common';
import { PayloadValidationPipe } from '../../../common/pipes/payload-validation.pipe.js';
import { UpdateBankAccountDto } from './update-bank-account.dto.js';

/** Payload do formulário "Dados bancários" do fature-fe. */
function bankAccountPayload(): Record<string, unknown> {
  return {
    bankCode: '001',
    bankName: ' Banco do Brasil ',
    branch: '1234-5',
    accountNumber: '12.345-x',
    accountType: 'CHECKING',
    holderName: ' Raipp Ltda ',
    holderDocument: '11.222.333/0001-81',
    pixKeyType: 'PHONE',
    pixKey: '(11) 98888-7777',
  };
}

const validate = (payload: unknown): Promise<UpdateBankAccountDto> =>
  PayloadValidationPipe.transform(payload, {
    type: 'body',
    metatype: UpdateBankAccountDto,
  });

async function messagesOf(payload: unknown): Promise<string[]> {
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

describe('UpdateBankAccountDto', () => {
  it('normalizes the form payload like the supplier bank account', async () => {
    await expect(validate(bankAccountPayload())).resolves.toEqual({
      bankCode: '001',
      bankName: 'Banco do Brasil',
      branch: '1234-5',
      accountNumber: '12345-X',
      accountType: 'CHECKING',
      holderName: 'Raipp Ltda',
      holderDocument: '11222333000181',
      pixKeyType: 'PHONE',
      pixKey: '+5511988887777',
    });
  });

  it('stores the Pix key as the DICT registers it', async () => {
    await expect(
      validate({ pixKeyType: 'EMAIL', pixKey: ' Financeiro@Raipp.com.br ' }),
    ).resolves.toMatchObject({ pixKey: 'financeiro@raipp.com.br' });
    await expect(
      validate({ pixKeyType: 'CPF', pixKey: '529.982.247-25' }),
    ).resolves.toMatchObject({ pixKey: '52998224725' });
    await expect(
      validate({
        pixKeyType: 'EVP',
        pixKey: '123E4567-E89B-12D3-A456-426614174000',
      }),
    ).resolves.toMatchObject({
      pixKey: '123e4567-e89b-12d3-a456-426614174000',
    });
  });

  it('requires a Pix key valid for its type', async () => {
    await expect(
      messagesOf({ pixKeyType: 'CPF', pixKey: '529.982.247-24' }),
    ).resolves.toEqual(['Informe uma chave Pix válida para o tipo escolhido']);
    await expect(messagesOf({ pixKeyType: 'EVP' })).resolves.toEqual([
      'Informe uma chave Pix válida para o tipo escolhido',
    ]);
  });

  it('requires bank, branch, account and type together', async () => {
    await expect(messagesOf({ bankCode: '341' })).resolves.toEqual([
      'Informe a agência: só números, com o dígito depois do hífen',
      'Informe a conta com o dígito: só números, com o dígito depois do hífen',
      'Informe o tipo da conta: corrente (CHECKING) ou poupança (SAVINGS)',
    ]);
  });

  it('validates the holder document', async () => {
    await expect(messagesOf({ holderDocument: '123' })).resolves.toEqual([
      'CPF/CNPJ do titular inválido',
    ]);
  });

  it('clears the empty fields', async () => {
    await expect(
      validate({ bankCode: '', pixKeyType: '', pixKey: '', holderName: ' ' }),
    ).resolves.toEqual({
      bankCode: null,
      pixKeyType: null,
      pixKey: null,
      holderName: null,
    });
  });

  it('does not let the organization release the manual payment by itself', async () => {
    const dto = await validate({
      ...bankAccountPayload(),
      bankTransferEnabled: true,
      pixMode: 'MANUAL',
      organizationId: 'org-2',
    });

    expect(dto).not.toHaveProperty('bankTransferEnabled');
    expect(dto).not.toHaveProperty('pixMode');
    expect(dto).not.toHaveProperty('organizationId');
  });
});
