import type { ProviderCapabilities } from '../providers/payment-provider.js';
import {
  PlatformRate,
  selectCheapestProviders,
} from './select-cheapest-provider.js';

const capabilities: Record<string, ProviderCapabilities> = {
  ALPHA: {
    methods: ['BANK_SLIP', 'PIX', 'CREDIT_CARD'],
    cardCapture: 'RAW',
    supportsSplit: true,
  },
  BETA: {
    methods: ['PIX', 'CREDIT_CARD'],
    cardCapture: 'PROVIDER_TOKEN',
    supportsSplit: true,
  },
};

function rate(
  provider: string,
  method: string,
  costFixed: number,
  costPercent: number,
  active = true,
): PlatformRate {
  return { provider, method, costFixed, costPercent, active };
}

describe('selectCheapestProviders', () => {
  it('picks the cheapest provider of each method, which may differ per method', () => {
    const rates = [
      rate('ALPHA', 'PIX', 0.3, 0),
      rate('BETA', 'PIX', 0.99, 0),
      rate('ALPHA', 'CREDIT_CARD', 0.49, 4.29),
      rate('BETA', 'CREDIT_CARD', 0.49, 3.5),
      rate('ALPHA', 'BANK_SLIP', 1.99, 0),
    ];

    expect(selectCheapestProviders(rates, capabilities, 100)).toEqual({
      PIX: 'ALPHA',
      CREDIT_CARD: 'BETA',
      BANK_SLIP: 'ALPHA',
    });
  });

  it('compares fixed plus percentage over the reference amount', () => {
    const rates = [
      rate('ALPHA', 'CREDIT_CARD', 0, 4),
      rate('BETA', 'CREDIT_CARD', 2, 2),
    ];

    // R$ 50: ALPHA 2,00 x BETA 3,00 | R$ 500: ALPHA 20,00 x BETA 12,00
    expect(selectCheapestProviders(rates, capabilities, 50).CREDIT_CARD).toBe(
      'ALPHA',
    );
    expect(selectCheapestProviders(rates, capabilities, 500).CREDIT_CARD).toBe(
      'BETA',
    );
  });

  it('breaks ties by provider code so the result is always the same', () => {
    const rates = [rate('BETA', 'PIX', 1, 0), rate('ALPHA', 'PIX', 1, 0)];

    expect(selectCheapestProviders(rates, capabilities, 100).PIX).toBe('ALPHA');
  });

  it('ignores inactive rates', () => {
    const rates = [
      rate('ALPHA', 'PIX', 0.1, 0, false),
      rate('BETA', 'PIX', 0.99, 0),
    ];

    expect(selectCheapestProviders(rates, capabilities, 100).PIX).toBe('BETA');
  });

  it('ignores providers without an adapter or without support for the method', () => {
    const rates = [
      rate('GAMMA', 'PIX', 0.01, 0),
      rate('BETA', 'BANK_SLIP', 0.5, 0),
      rate('ALPHA', 'DEBIT_CARD', 0.35, 1.89),
    ];

    expect(selectCheapestProviders(rates, capabilities, 100)).toEqual({});
  });
});
