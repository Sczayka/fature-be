import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EmployeesService } from './employees.service.js';

vi.mock('../../prisma/prisma.service.js', () => ({ PrismaService: class {} }));

function employee(overrides: Record<string, unknown> = {}) {
  return {
    id: 'employee-1',
    name: 'Ana Souza',
    cpf: '52998224725',
    role: 'Vendedora',
    email: null,
    phone: null,
    admissionDate: new Date('2025-03-10T00:00:00Z'),
    salary: new Prisma.Decimal(3200.5),
    pixKeyType: 'PHONE',
    pixKey: '+5511988887777',
    bankCode: null,
    bankName: null,
    branch: null,
    accountNumber: null,
    accountType: null,
    notes: null,
    active: true,
    createdAt: new Date('2026-10-01T12:00:00Z'),
    updatedAt: new Date('2026-10-01T12:00:00Z'),
    ...overrides,
  };
}

describe('EmployeesService', () => {
  let prisma: any;
  let service: EmployeesService;

  beforeEach(() => {
    prisma = {
      employee: {
        findMany: vi.fn().mockResolvedValue([employee()]),
        findFirst: vi.fn().mockResolvedValue(null),
        count: vi.fn().mockResolvedValue(1),
        create: vi.fn().mockResolvedValue(employee()),
        update: vi.fn().mockResolvedValue(employee()),
        delete: vi.fn().mockResolvedValue(employee()),
      },
      financialEntry: { count: vi.fn().mockResolvedValue(0) },
    };
    service = new EmployeesService(prisma);
  });

  it('returns the salary as a number and the admission as a date', async () => {
    const { data } = await service.findAll('org-1', { page: 1, limit: 10 });

    expect(data[0]).toMatchObject({
      salary: 3200.5,
      admissionDate: '2025-03-10',
    });
  });

  it('creates an employee with the admission at midnight UTC', async () => {
    await service.create('org-1', {
      name: 'Ana Souza',
      cpf: '52998224725',
      salary: 3200.5,
      admissionDate: '2025-03-10',
    });

    expect(prisma.employee.create.mock.calls[0][0].data).toMatchObject({
      organizationId: 'org-1',
      name: 'Ana Souza',
      salary: 3200.5,
      admissionDate: new Date('2025-03-10T00:00:00Z'),
    });
  });

  it('rejects a CPF already registered and suggests reactivating an inactive one', async () => {
    prisma.employee.findFirst.mockResolvedValue({ active: false });

    await expect(
      service.create('org-1', { name: 'Ana', cpf: '52998224725', salary: 1 }),
    ).rejects.toThrow(
      new ConflictException(
        'Já existe um funcionário inativo com este CPF: reative-o em vez de cadastrar outro.',
      ),
    );
  });

  it('requires the whole bank account in a partial update', async () => {
    prisma.employee.findFirst.mockResolvedValue(employee());

    await expect(
      service.update('employee-1', 'org-1', { bankCode: '341' }),
    ).rejects.toThrow(
      new BadRequestException(
        'Informe banco, agência, conta e tipo juntos, ou nenhum deles',
      ),
    );
  });

  it('does not delete an employee with payments and suggests inactivating', async () => {
    prisma.employee.findFirst.mockResolvedValue(employee());
    prisma.financialEntry.count.mockResolvedValue(2);

    await expect(service.remove('employee-1', 'org-1')).rejects.toThrow(
      'Este funcionário tem 2 pagamentos na folha e não pode ser excluído. Inative-o para que ele não entre nas próximas folhas.',
    );
    expect(prisma.employee.delete).not.toHaveBeenCalled();
  });

  it('searches the active ones by name, role or CPF with or without the mask', async () => {
    prisma.employee.findMany.mockResolvedValue([
      {
        id: 'employee-1',
        name: 'Ana',
        role: null,
        salary: new Prisma.Decimal(10),
        active: true,
      },
    ]);

    await expect(service.search('org-1', '529.982')).resolves.toEqual([
      { id: 'employee-1', name: 'Ana', role: null, salary: 10, active: true },
    ]);
    expect(prisma.employee.findMany.mock.calls[0][0].where).toEqual({
      organizationId: 'org-1',
      active: true,
      OR: [
        { name: { contains: '529.982', mode: 'insensitive' } },
        { role: { contains: '529.982', mode: 'insensitive' } },
        { cpf: { contains: '529982' } },
      ],
    });
  });
});
