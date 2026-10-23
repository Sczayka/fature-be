import { setupOrganizationFinancial } from './organization-financial-setup.js';

describe('setupOrganizationFinancial', () => {
  let db: any;

  beforeEach(() => {
    db = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      financialAccount: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockResolvedValue({}),
        createMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
      financialCategory: {
        createMany: vi.fn().mockResolvedValue({ count: 12 }),
      },
      paymentGatewayAccount: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { id: 'gateway-1', provider: 'ASAAS', financialAccount: null },
          ]),
      },
    };
  });

  const openingDate = new Date('2026-10-23T00:00:00Z');

  it('creates the main bank account, the cash, the categories and the provider account the first time', async () => {
    await setupOrganizationFinancial(db, 'org-1', '2026-10-23');

    expect(db.financialAccount.createMany.mock.calls[0][0].data).toEqual([
      {
        organizationId: 'org-1',
        name: 'Conta bancária',
        type: 'BANK',
        isMain: true,
        openingDate,
      },
      { organizationId: 'org-1', name: 'Dinheiro', type: 'CASH', openingDate },
    ]);

    const categories = db.financialCategory.createMany.mock.calls[0][0];

    expect(categories.skipDuplicates).toBe(true);
    expect(categories.data).toEqual(
      expect.arrayContaining([
        { organizationId: 'org-1', name: 'Vendas e serviços', direction: 'IN' },
        {
          organizationId: 'org-1',
          name: 'Salários e encargos',
          direction: 'OUT',
        },
      ]),
    );
    expect(db.financialAccount.create).toHaveBeenCalledWith({
      data: {
        organizationId: 'org-1',
        name: 'Conta Fature',
        type: 'PAYMENT_PROVIDER',
        paymentGatewayAccountId: 'gateway-1',
        openingDate,
      },
    });
  });

  it('locks the organization before reading the accounts', async () => {
    await setupOrganizationFinancial(db, 'org-1', '2026-10-23');

    expect(db.$executeRaw.mock.calls[0].slice(1)).toEqual([
      'financial-setup:org-1',
    ]);
    expect(db.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      db.financialAccount.findMany.mock.invocationCallOrder[0],
    );
  });

  it('only creates what is missing afterwards', async () => {
    db.financialAccount.findMany.mockResolvedValue([{ isMain: true }]);
    db.paymentGatewayAccount.findMany.mockResolvedValue([
      { id: 'gateway-1', provider: 'ASAAS', financialAccount: { id: 'acc' } },
    ]);

    await setupOrganizationFinancial(db, 'org-1', '2026-10-23');

    expect(db.financialAccount.createMany).not.toHaveBeenCalled();
    expect(db.financialCategory.createMany).not.toHaveBeenCalled();
    expect(db.financialAccount.create).not.toHaveBeenCalled();
  });

  it('brings back a main account when the organization has none', async () => {
    db.financialAccount.findMany.mockResolvedValue([{ isMain: false }]);
    db.paymentGatewayAccount.findMany.mockResolvedValue([]);

    await setupOrganizationFinancial(db, 'org-1', '2026-10-23');

    expect(db.financialAccount.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: 'Conta bancária', isMain: true }),
    });
    expect(db.financialCategory.createMany).not.toHaveBeenCalled();
  });

  it('names each provider account after the provider when there is more than one', async () => {
    db.paymentGatewayAccount.findMany.mockResolvedValue([
      { id: 'gateway-1', provider: 'ASAAS', financialAccount: null },
      { id: 'gateway-2', provider: 'PAGARME', financialAccount: null },
    ]);

    await setupOrganizationFinancial(db, 'org-1', '2026-10-23');

    expect(
      db.financialAccount.create.mock.calls.map(([{ data }]: any) => data.name),
    ).toEqual(['Conta Fature (Asaas)', 'Conta Fature (Pagarme)']);
  });
});
