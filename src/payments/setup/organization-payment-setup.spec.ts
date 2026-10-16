import type { ProviderCapabilities } from '../providers/payment-provider.js';
import { setupOrganizationPayments } from './organization-payment-setup.js';

const capabilities: Record<string, ProviderCapabilities> = {
  ALPHA: {
    methods: ['BANK_SLIP', 'PIX', 'CREDIT_CARD'],
    cardCapture: 'RAW',
    supportsSplit: true,
  },
  BETA: { methods: ['CREDIT_CARD'], cardCapture: 'RAW', supportsSplit: true },
};

function platformRate(
  provider: string,
  method: string,
  cost: number,
  active = true,
) {
  return {
    provider,
    method,
    costFixed: cost,
    costPercent: 0,
    defaultFeeFixed: cost,
    defaultFeePercent: 0,
    active,
  };
}

describe('setupOrganizationPayments', () => {
  let db: any;

  beforeEach(() => {
    db = {
      paymentGatewayMethod: {
        count: vi.fn().mockResolvedValue(0),
        createMany: vi.fn().mockResolvedValue({ count: 0 }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      platformPaymentMethod: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            platformRate('ALPHA', 'BANK_SLIP', 1.99),
            platformRate('ALPHA', 'PIX', 1.99),
            platformRate('ALPHA', 'CREDIT_CARD', 3),
            platformRate('ALPHA', 'DEBIT_CARD', 2, false),
            platformRate('BETA', 'CREDIT_CARD', 1),
          ]),
      },
      paymentGatewayAccount: {
        upsert: vi
          .fn()
          .mockImplementation(({ create }) =>
            Promise.resolve({ id: `acc-${create.provider}` }),
          ),
      },
    };
  });

  const run = () =>
    setupOrganizationPayments(db, 'org-1', {
      capabilities,
      referenceAmount: 100,
    });

  it('opens one account per winning provider, awaiting the company info', async () => {
    await expect(run()).resolves.toBe(true);

    const accounts = db.paymentGatewayAccount.upsert.mock.calls.map(
      ([args]: any) => args.create,
    );

    expect(accounts).toEqual([
      expect.objectContaining({
        provider: 'ALPHA',
        accountId: '',
        status: 'AWAITING_COMPANY_INFO',
      }),
      expect.objectContaining({ provider: 'BETA' }),
    ]);
  });

  it('creates the methods with the default fees and no default yet', async () => {
    await run();

    const alphaRows = db.paymentGatewayMethod.createMany.mock.calls[0][0].data;

    expect(alphaRows).toContainEqual({
      paymentGatewayAccountId: 'acc-ALPHA',
      method: 'BANK_SLIP',
      active: true,
      isDefaultForMethod: false,
      feeFixed: 1.99,
      feePercent: 0,
    });
    // Débito fica cadastrado, mas inativo como na plataforma
    expect(alphaRows).toContainEqual(
      expect.objectContaining({ method: 'DEBIT_CARD', active: false }),
    );
  });

  it('marks as default only the cheapest provider of each method', async () => {
    await run();

    expect(db.paymentGatewayMethod.updateMany).toHaveBeenCalledWith({
      where: {
        paymentGatewayAccountId: 'acc-ALPHA',
        method: { in: ['BANK_SLIP', 'PIX'] },
      },
      data: { isDefaultForMethod: true },
    });
    expect(db.paymentGatewayMethod.updateMany).toHaveBeenCalledWith({
      where: {
        paymentGatewayAccountId: 'acc-BETA',
        method: { in: ['CREDIT_CARD'] },
      },
      data: { isDefaultForMethod: true },
    });
  });

  it('does not change an organization that already has its methods', async () => {
    db.paymentGatewayMethod.count.mockResolvedValue(3);

    await expect(run()).resolves.toBe(false);
    expect(db.paymentGatewayAccount.upsert).not.toHaveBeenCalled();
    expect(db.paymentGatewayMethod.updateMany).not.toHaveBeenCalled();
  });

  it('configures nothing while there are no negotiated rates', async () => {
    db.platformPaymentMethod.findMany.mockResolvedValue([]);

    await expect(run()).resolves.toBe(false);
    expect(db.paymentGatewayAccount.upsert).not.toHaveBeenCalled();
  });
});
