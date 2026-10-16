import { HttpException, NotFoundException } from '@nestjs/common';
import { PaymentProviderError } from '../providers/payment-provider.js';
import { PaymentProviderRegistry } from '../providers/payment-provider.registry.js';
import { WebhooksController } from './webhooks.controller.js';

vi.mock('../../prisma/prisma.service.js', () => ({ PrismaService: class {} }));

describe('WebhooksController', () => {
  let provider: any;
  let paymentEvents: any;
  let controller: WebhooksController;

  const request = (body = '{}') =>
    ({
      headers: { 'x-token': 'ok' },
      rawBody: Buffer.from(body),
    }) as any;

  beforeEach(() => {
    provider = {
      code: 'ALPHA',
      parseWebhook: vi.fn().mockReturnValue([{ externalEventId: 'evt_1' }]),
    };
    paymentEvents = { handle: vi.fn().mockResolvedValue(undefined) };
    controller = new WebhooksController(
      new PaymentProviderRegistry([provider]),
      paymentEvents,
    );
  });

  it('hands the raw request to the provider adapter and applies its events', async () => {
    const req = request('{"id":"evt_1"}');

    await expect(controller.receive('alpha', req)).resolves.toEqual({
      received: true,
    });
    expect(provider.parseWebhook).toHaveBeenCalledWith({
      headers: req.headers,
      rawBody: req.rawBody,
    });
    expect(paymentEvents.handle).toHaveBeenCalledWith('ALPHA', [
      { externalEventId: 'evt_1' },
    ]);
  });

  it('answers 404 to an unknown provider', async () => {
    await expect(controller.receive('other', request())).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('answers 401 when the adapter does not authenticate the call', async () => {
    provider.parseWebhook.mockImplementation(() => {
      throw new PaymentProviderError('Webhook não autenticado', 'UNAUTHORIZED');
    });

    const error = await controller
      .receive('alpha', request())
      .catch((caught) => caught);

    expect(error).toBeInstanceOf(HttpException);
    expect(error.getStatus()).toBe(401);
    expect(paymentEvents.handle).not.toHaveBeenCalled();
  });
});
