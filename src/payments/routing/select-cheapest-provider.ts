import type { PaymentMethod } from '../payments.constants.js';
import type { ProviderCapabilities } from '../providers/payment-provider.js';

/** Linha de PlatformPaymentMethod usada na escolha (custo negociado entre o Fature e o provedor). */
export interface PlatformRate {
  provider: string;
  method: string;
  costFixed: number;
  costPercent: number;
  active: boolean;
}

/**
 * Provedor de menor custo para cada método: fixo + percentual sobre um valor de referência.
 * Só entram linhas ativas de provedores com adaptador que suporta o método. O empate é
 * decidido pelo código do provedor, para o resultado ser sempre o mesmo.
 */
export function selectCheapestProviders(
  rates: PlatformRate[],
  capabilities: Record<string, ProviderCapabilities>,
  referenceAmount: number,
): Partial<Record<PaymentMethod, string>> {
  const winners: Partial<
    Record<PaymentMethod, { provider: string; cost: number }>
  > = {};

  for (const rate of rates) {
    const method = rate.method as PaymentMethod;

    if (!rate.active || !capabilities[rate.provider]?.methods.includes(method))
      continue;

    const cost = rate.costFixed + (referenceAmount * rate.costPercent) / 100;
    const current = winners[method];

    if (
      !current ||
      cost < current.cost ||
      (cost === current.cost && rate.provider < current.provider)
    )
      winners[method] = { provider: rate.provider, cost };
  }

  return Object.fromEntries(
    Object.entries(winners).map(([method, winner]) => [
      method,
      winner.provider,
    ]),
  );
}
