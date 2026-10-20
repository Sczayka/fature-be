import { OrganizationPaymentMethodsService } from './organization-payment-methods.service.js';

vi.mock('../prisma/prisma.service.js', () => ({ PrismaService: class {} }));

/** Formas como o roteamento as devolve: boleto e PIX no provedor, com taxa. */
const ROUTED_METHODS = [
  {
    method: 'BANK_SLIP',
    available: true,
    feeFixed: 1.99,
    feePercent: 0,
    receiptDays: 1,
  },
  {
    method: 'CREDIT_CARD',
    available: false,
    feeFixed: 0,
    feePercent: 0,
    receiptDays: 0,
  },
  {
    method: 'DEBIT_CARD',
    available: false,
    feeFixed: 0,
    feePercent: 0,
    receiptDays: 0,
  },
  {
    method: 'PIX',
    available: true,
    feeFixed: 0.99,
    feePercent: 0,
    receiptDays: 0,
  },
  {
    method: 'BANK_TRANSFER',
    available: false,
    feeFixed: 0,
    feePercent: 0,
    receiptDays: 0,
  },
];

const COMPLETE_ACCOUNT = {
  organizationId: 'org-1',
  bankCode: '341',
  bankName: 'Itaú',
  branch: '0001',
  accountNumber: '12345-6',
  accountType: 'CHECKING',
  holderName: 'Raipp Ltda',
  holderDocument: '11222333000181',
  pixKeyType: null,
  pixKey: null,
  updatedAt: new Date('2026-10-20T12:00:00Z'),
};

const FREE = { feeFixed: 0, feePercent: 0, receiptDays: 0 };

describe('OrganizationPaymentMethodsService', () => {
  let prisma: any;
  let routing: any;
  let service: OrganizationPaymentMethodsService;

  const configure = (config: Record<string, unknown>) =>
    prisma.organization.findUnique.mockResolvedValue({
      bankTransferEnabled: false,
      pixMode: 'AUTOMATIC',
      bankAccount: null,
      ...config,
    });

  const methodOf = async (method: string) =>
    (await service.list('org-1')).find((row) => row.method === method);

  beforeEach(() => {
    prisma = {
      organization: {
        findUnique: vi.fn().mockResolvedValue({
          bankTransferEnabled: false,
          pixMode: 'AUTOMATIC',
          bankAccount: null,
        }),
      },
    };
    routing = {
      listMethods: vi.fn().mockResolvedValue(ROUTED_METHODS),
    };
    service = new OrganizationPaymentMethodsService(prisma, routing);
  });

  it('keeps the bank transfer unavailable while it is not released or the data is incomplete', async () => {
    configure({ bankTransferEnabled: false, bankAccount: COMPLETE_ACCOUNT });

    await expect(methodOf('BANK_TRANSFER')).resolves.toMatchObject({
      available: false,
    });

    configure({
      bankTransferEnabled: true,
      bankAccount: { ...COMPLETE_ACCOUNT, holderDocument: null },
    });

    await expect(methodOf('BANK_TRANSFER')).resolves.toMatchObject({
      available: false,
    });

    configure({ bankTransferEnabled: true, bankAccount: null });

    await expect(methodOf('BANK_TRANSFER')).resolves.toMatchObject({
      available: false,
    });
  });

  it('offers the bank transfer for free with the complete bank data', async () => {
    configure({ bankTransferEnabled: true, bankAccount: COMPLETE_ACCOUNT });

    await expect(methodOf('BANK_TRANSFER')).resolves.toEqual({
      method: 'BANK_TRANSFER',
      available: true,
      ...FREE,
    });
    expect(prisma.organization.findUnique).toHaveBeenCalledWith({
      where: { id: 'org-1' },
      select: { bankTransferEnabled: true, pixMode: true, bankAccount: true },
    });
  });

  it('makes the PIX unavailable in the manual mode without a key, even with a provider', async () => {
    configure({ pixMode: 'MANUAL', bankAccount: COMPLETE_ACCOUNT });

    await expect(methodOf('PIX')).resolves.toEqual({
      method: 'PIX',
      available: false,
      ...FREE,
    });
  });

  it('offers the PIX for free in the manual mode with the key', async () => {
    configure({
      pixMode: 'MANUAL',
      bankAccount: {
        ...COMPLETE_ACCOUNT,
        pixKeyType: 'CNPJ',
        pixKey: '11222333000181',
      },
    });

    await expect(methodOf('PIX')).resolves.toEqual({
      method: 'PIX',
      available: true,
      ...FREE,
    });
  });

  it('is the same as the routing in the automatic mode', async () => {
    configure({
      bankAccount: {
        ...COMPLETE_ACCOUNT,
        pixKeyType: 'CNPJ',
        pixKey: '11222333000181',
      },
    });

    await expect(service.list('org-1')).resolves.toEqual(ROUTED_METHODS);
  });

  it('treats a missing organization as having no manual payment', async () => {
    prisma.organization.findUnique.mockResolvedValue(null);

    await expect(service.list('org-1')).resolves.toEqual(ROUTED_METHODS);
  });

  it('maps the availability of every method', async () => {
    configure({ bankTransferEnabled: true, bankAccount: COMPLETE_ACCOUNT });

    const availability = await service.availability('org-1');

    expect(availability.get('BANK_TRANSFER')).toBe(true);
    expect(availability.get('BANK_SLIP')).toBe(true);
    expect(availability.get('DEBIT_CARD')).toBe(false);
  });
});
