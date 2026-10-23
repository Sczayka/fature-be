import { BadRequestException } from '@nestjs/common';
import { PayloadValidationPipe } from '../../../common/pipes/payload-validation.pipe.js';
import { CreateEmployeeDto } from './create-employee.dto.js';

/** Payload do formulário de funcionário do fature-fe. */
function employeePayload(): Record<string, any> {
  return {
    name: ' Ana Souza ',
    cpf: '529.982.247-25',
    role: 'Vendedora',
    email: ' Ana@Empresa.com.br ',
    phone: '(11) 98888-7777',
    admissionDate: '2025-03-10',
    salary: 3200.5,
    pixKeyType: 'PHONE',
    pixKey: '(11) 98888-7777',
    bankCode: '',
    bankName: '',
    branch: '',
    accountNumber: '',
    accountType: '',
    notes: '',
    active: true,
  };
}

const validate = (payload: unknown) =>
  PayloadValidationPipe.transform(payload, {
    type: 'body',
    metatype: CreateEmployeeDto,
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

describe('CreateEmployeeDto', () => {
  it('normalizes the form payload: digits, lowercase email and empty as null', async () => {
    const dto: CreateEmployeeDto = await validate(employeePayload());

    expect(dto).toMatchObject({
      name: 'Ana Souza',
      cpf: '52998224725',
      email: 'ana@empresa.com.br',
      phone: '11988887777',
      salary: 3200.5,
      pixKey: '+5511988887777',
      bankCode: null,
      branch: null,
      notes: null,
    });
  });

  it('accepts just the name and the salary', async () => {
    await expect(validate({ name: 'Bia', salary: 0 })).resolves.toBeInstanceOf(
      CreateEmployeeDto,
    );
  });

  it('rejects a CNPJ, an invalid CPF and a negative salary', async () => {
    await expect(
      messagesOf({ ...employeePayload(), cpf: '11.222.333/0001-81' }),
    ).resolves.toEqual(['CPF inválido: informe os 11 dígitos']);
    await expect(
      messagesOf({ ...employeePayload(), cpf: '529.982.247-24' }),
    ).resolves.toEqual(['CPF inválido']);
    await expect(
      messagesOf({ ...employeePayload(), salary: -1 }),
    ).resolves.toEqual([
      'Informe o salário: um número de 0 a 999.999.999,99, com até 2 casas decimais',
    ]);
  });

  it('requires bank, branch, account and type together', async () => {
    const messages = await messagesOf({
      ...employeePayload(),
      bankCode: '341',
    });

    expect(messages).toEqual([
      'Informe a agência: só números, com o dígito depois do hífen',
      'Informe a conta com o dígito: só números, com o dígito depois do hífen',
      'Informe o tipo da conta: corrente (CHECKING) ou poupança (SAVINGS)',
    ]);
  });
});
