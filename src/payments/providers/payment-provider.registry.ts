import { Inject, Injectable } from '@nestjs/common';
import type { PaymentProvider } from './payment-provider.js';

export const PAYMENT_PROVIDERS = Symbol('PAYMENT_PROVIDERS');

/** Adaptadores disponíveis, pelo código do provedor gravado nas contas. */
@Injectable()
export class PaymentProviderRegistry {
  private readonly providers: Map<string, PaymentProvider>;

  constructor(@Inject(PAYMENT_PROVIDERS) providers: PaymentProvider[]) {
    this.providers = new Map(
      providers.map((provider) => [provider.code, provider]),
    );
  }

  find(code: string): PaymentProvider | null {
    return this.providers.get(code) ?? null;
  }

  get(code: string): PaymentProvider {
    const provider = this.find(code);

    if (!provider) {
      throw new Error(`Provedor de pagamento sem adaptador: ${code}`);
    }

    return provider;
  }
}
