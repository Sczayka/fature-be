import { CredentialsCipher } from '../../credentials/credentials-cipher.js';
import { PaymentProviderError } from '../payment-provider.js';
import { AsaasClient } from './asaas.client.js';
import { AsaasProvider } from './asaas.provider.js';

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const payment = {
  id: 'pay_1',
  status: 'PENDING',
  invoiceUrl: 'https://asaas/i/pay_1',
  bankSlipUrl: 'https://asaas/b/pay_1',
  deleted: false,
};

describe('AsaasProvider', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let provider: AsaasProvider;
  let account: any;

  beforeEach(() => {
    vi.stubEnv(
      'PAYMENT_GATEWAY_ENCRYPTION_KEY',
      'chave-de-teste-com-pelo-menos-32-bytes',
    );
    vi.stubEnv('ASAAS_API_URL', 'https://asaas.test/api');
    vi.stubEnv('ASAAS_WEBHOOK_TOKEN', 'token-do-webhook-com-32-caracteres!!');

    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const cipher = new CredentialsCipher();
    provider = new AsaasProvider(new AsaasClient(), cipher);
    account = {
      id: 'acc-1',
      provider: 'ASAAS',
      accountId: 'sub_1',
      metadata: { apiKey: cipher.encrypt('subaccount-key') },
    };
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const sentBody = (call = 0) => JSON.parse(fetchMock.mock.calls[call][1].body);

  it('creates the bank slip with native discount, fine and interest and loads its digitable line', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, payment))
      .mockResolvedValueOnce(
        jsonResponse(200, { identificationField: '23790.00009' }),
      );

    const charge = await provider.createCharge(account, {
      method: 'BANK_SLIP',
      customerExternalId: 'cus_1',
      value: 99,
      dueDate: '2026-10-31',
      description: 'Fatura',
      reference: 'charge-1',
      splitAmount: 0,
      discount: { value: 0.99, until: '2026-10-30' },
      fine: 0.99,
      interestPercent: 1,
    });

    expect(fetchMock.mock.calls[0][1].headers.access_token).toBe(
      'subaccount-key',
    );
    expect(sentBody()).toEqual({
      customer: 'cus_1',
      billingType: 'BOLETO',
      value: 99,
      dueDate: '2026-10-31',
      description: 'Fatura',
      externalReference: 'charge-1',
      fine: { type: 'FIXED', value: 0.99 },
      interest: { value: 1 },
      discount: { type: 'FIXED', value: 0.99, dueDateLimitDays: 1 },
    });
    // GET sem body: o Asaas responde 403 a GET com body
    expect(fetchMock.mock.calls[1][1].body).toBeUndefined();
    expect(charge).toMatchObject({
      externalId: 'pay_1',
      status: 'PENDING',
      details: {
        bankSlipUrl: 'https://asaas/b/pay_1',
        identificationField: '23790.00009',
      },
    });
  });

  it('creates the PIX with the value of the day, without fine or interest, and returns the QR Code', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(200, { ...payment, billingType: 'PIX' }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          encodedImage: 'iVBOR',
          payload: '000201',
          expirationDate: '2027-10-30 23:59:59',
        }),
      );

    const charge = await provider.createCharge(account, {
      method: 'PIX',
      customerExternalId: 'cus_1',
      value: 98.01,
      dueDate: '2026-10-30',
      description: 'Fatura',
      reference: 'charge-2',
      splitAmount: 0,
    });

    expect(sentBody()).toMatchObject({
      billingType: 'PIX',
      value: 98.01,
      fine: { type: 'FIXED', value: 0 },
      interest: { value: 0 },
    });
    expect(charge.details).toMatchObject({
      pixPayload: '000201',
      pixQrCodeImage: 'iVBOR',
    });
  });

  it('sends the Fature margin as split to the platform wallet', async () => {
    vi.stubEnv('ASAAS_PLATFORM_WALLET_ID', 'wallet-fature');
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, payment))
      .mockResolvedValueOnce(jsonResponse(200, { payload: 'x' }));

    await provider.createCharge(account, {
      method: 'PIX',
      customerExternalId: 'cus_1',
      value: 100,
      dueDate: '2026-10-30',
      description: 'Fatura',
      reference: 'charge-3',
      splitAmount: 0.7,
    });

    expect(sentBody().split).toEqual([
      { walletId: 'wallet-fature', fixedValue: 0.7 },
    ]);
  });

  it('hides the reason of a refused card behind a generic message', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(400, {
        errors: [{ description: 'Cartão bloqueado por suspeita de fraude' }],
      }),
    );

    const error = await provider
      .createCharge(account, {
        method: 'CREDIT_CARD',
        customerExternalId: 'cus_1',
        value: 100,
        dueDate: '2026-10-16',
        description: 'Fatura',
        reference: 'charge-4',
        splitAmount: 0,
        payerIp: '200.1.1.1',
        payment: {
          mode: 'RAW',
          card: {
            holderName: 'TITULAR',
            number: '4444444444444444',
            expiryMonth: '12',
            expiryYear: '2030',
            ccv: '123',
          },
          holder: {
            name: 'Titular',
            email: 'titular@email.com',
            cpfCnpj: '12345678909',
            postalCode: '01001000',
            addressNumber: '10',
            phone: '11999999999',
          },
        },
      })
      .catch((caught) => caught);

    expect(sentBody()).toMatchObject({
      billingType: 'CREDIT_CARD',
      remoteIp: '200.1.1.1',
      creditCard: { number: '4444444444444444' },
    });
    expect(error).toBeInstanceOf(PaymentProviderError);
    expect(error.kind).toBe('CARD_REFUSED');
    expect(error.message).not.toContain('fraude');
  });

  it('creates customers with the native notifications disabled', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: 'cus_1' }));

    await provider.createCustomer(account, {
      name: 'Cliente',
      cpfCnpj: '12345678909',
      email: 'cliente@email.com',
      phone: null,
      mobile: null,
      cep: null,
      addressLine: null,
      addressNumber: null,
      complement: null,
      district: null,
      municipalInscription: null,
      stateInscription: null,
    });

    expect(sentBody()).toMatchObject({
      name: 'Cliente',
      cpfCnpj: '12345678909',
      notificationDisabled: true,
    });
  });

  it('requires the customer document before calling the API', async () => {
    await expect(
      provider.createCustomer(account, {
        name: 'Sem documento',
        cpfCnpj: null,
      } as any),
    ).rejects.toMatchObject({ kind: 'INVALID_DATA' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects webhooks without the configured token', () => {
    expect(() =>
      provider.parseWebhook({
        headers: { 'asaas-access-token': 'outro-token' },
        rawBody: Buffer.from('{}'),
      }),
    ).toThrow(PaymentProviderError);
  });

  it('normalizes an authenticated payment event', () => {
    const [event] = provider.parseWebhook({
      headers: { 'asaas-access-token': 'token-do-webhook-com-32-caracteres!!' },
      rawBody: Buffer.from(
        JSON.stringify({
          id: 'evt_1',
          event: 'PAYMENT_RECEIVED',
          payment: {
            id: 'pay_1',
            value: 98.01,
            paymentDate: '2026-10-16',
            transactionReceiptUrl: 'https://www.asaas.com/comprovantes/1',
          },
        }),
      ),
    });

    expect(event).toMatchObject({
      externalEventId: 'evt_1',
      type: 'CHARGE_PAID',
      providerType: 'PAYMENT_RECEIVED',
      chargeExternalId: 'pay_1',
      paidAt: '2026-10-16',
      paidValue: 98.01,
      creditDate: null,
      receiptUrl: 'https://www.asaas.com/comprovantes/1',
    });
  });

  it('reads the estimated credit date until the money is credited', () => {
    const parse = (payment: Record<string, unknown>) =>
      provider.parseWebhook({
        headers: {
          'asaas-access-token': 'token-do-webhook-com-32-caracteres!!',
        },
        rawBody: Buffer.from(
          JSON.stringify({
            id: 'evt_2',
            event: 'PAYMENT_CONFIRMED',
            payment: { id: 'pay_1', value: 100, ...payment },
          }),
        ),
      })[0];

    expect(parse({ estimatedCreditDate: '2026-11-16' }).creditDate).toBe(
      '2026-11-16',
    );
    expect(
      parse({ estimatedCreditDate: '2026-11-16', creditDate: '2026-11-17' })
        .creditDate,
    ).toBe('2026-11-17');
  });

  it('reads the available balance of the subaccount', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { balance: 1234.56 }));

    await expect(provider.getBalance(account)).resolves.toBe(1234.56);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://asaas.test/api/v3/finance/balance',
    );
    expect(fetchMock.mock.calls[0][1].headers.access_token).toBe(
      'subaccount-key',
    );
  });
});
