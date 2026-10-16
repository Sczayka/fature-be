import { ASAAS_CAPABILITIES, ASAAS_PROVIDER } from './asaas/asaas.constants.js';
import type { ProviderCapabilities } from './payment-provider.js';

/**
 * Capacidades dos adaptadores disponíveis, como dados estáticos: o registro da organização
 * (hook do Better Auth) roda fora do DI do Nest. Novo provedor: registre aqui e em PaymentsModule.
 */
export const PROVIDER_CAPABILITIES: Record<string, ProviderCapabilities> = {
  [ASAAS_PROVIDER]: ASAAS_CAPABILITIES,
};
