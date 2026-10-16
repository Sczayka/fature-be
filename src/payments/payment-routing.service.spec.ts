import { PaymentRoutingService } from './payment-routing.service.js';
import { PaymentProviderRegistry } from './providers/payment-provider.registry.js';

vi.mock('../prisma/prisma.service.js', () => ({ PrismaService: class {} }));

const alphaProvider = {
  code: 'ALPHA',
  capabilities: {
    methods: ['BANK_SLIP', 'PIX'],
    cardCapture: null,
    supportsSplit: true,
  },
};

function defaultRow(method: string, overrides: Record<string, unknown> = {}) {
  return {
    method,
    active: true,
    isDefaultForMethod: true,
    feeFixed: 1.99,
    feePercent: 0,
    receiptDays: 1,
    paymentGatewayAccount: {
      id: 'acc-1',
      provider: 'ALPHA',
      status: 'ACTIVE',
    },
    ...overrides,
  };
}

describe('PaymentRoutingService', () => {
  let prisma: any;
  let service: PaymentRoutingService;

  beforeEach(() => {
    prisma = {
      paymentGatewayMethod: {
        findMany: vi
          .fn()
          .mockResolvedValue([defaultRow('BANK_SLIP'), defaultRow('PIX')]),
      },
      platformPaymentMethod: {
        findMany: vi.fn().mockResolvedValue([
          {
            provider: 'ALPHA',
            method: 'BANK_SLIP',
            costFixed: 1.5,
            costPercent: 0,
            active: true,
          },
          {
            provider: 'ALPHA',
            method: 'PIX',
            costFixed: 0.3,
            costPercent: 0,
            active: true,
          },
        ]),
      },
    };

    service = new PaymentRoutingService(
      prisma,
      new PaymentProviderRegistry([alphaProvider as any]),
    );
  });

  it('routes a method to the default account of the organization, with fee and cost', async () => {
    const route = await service.resolve('org-1', 'PIX');

    expect(route).toMatchObject({
      method: 'PIX',
      account: { id: 'acc-1' },
      provider: alphaProvider,
      fee: { fixed: 1.99, percent: 0 },
      cost: { fixed: 0.3, percent: 0 },
    });
    expect(prisma.paymentGatewayMethod.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          isDefaultForMethod: true,
          paymentGatewayAccount: { organizationId: 'org-1' },
        },
      }),
    );
  });

  it('makes a method unavailable without a default', async () => {
    await expect(service.resolve('org-1', 'CREDIT_CARD')).resolves.toBeNull();
  });

  it('makes a method unavailable while the account is not active', async () => {
    prisma.paymentGatewayMethod.findMany.mockResolvedValue([
      defaultRow('PIX', {
        paymentGatewayAccount: {
          id: 'acc-1',
          provider: 'ALPHA',
          status: 'AWAITING_COMPANY_INFO',
        },
      }),
    ]);

    await expect(service.resolve('org-1', 'PIX')).resolves.toBeNull();
  });

  it('makes a method unavailable when the platform rate is inactive', async () => {
    prisma.platformPaymentMethod.findMany.mockResolvedValue([
      {
        provider: 'ALPHA',
        method: 'PIX',
        costFixed: 0.3,
        costPercent: 0,
        active: false,
      },
    ]);

    await expect(service.resolve('org-1', 'PIX')).resolves.toBeNull();
  });

  it('makes a method unavailable when the adapter does not support it', async () => {
    prisma.paymentGatewayMethod.findMany.mockResolvedValue([
      defaultRow('DEBIT_CARD'),
    ]);

    await expect(service.resolve('org-1', 'DEBIT_CARD')).resolves.toBeNull();
  });

  it('lists every method with availability and the organization fee', async () => {
    const methods = await service.listMethods('org-1');

    expect(methods).toEqual([
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
        feeFixed: 1.99,
        feePercent: 0,
        receiptDays: 1,
      },
    ]);
  });
});
