import { frontendUrl } from '../common/utils/public-url.js';
import { CHECKOUT_PATH } from './invoices.constants.js';

/** Link da página pública de pagamento da fatura: {FRONTEND_URL}/pagar/{checkoutToken}. */
export function checkoutUrl(checkoutToken: string | null): string | null {
  if (!checkoutToken) return null;

  return `${frontendUrl()}${CHECKOUT_PATH}/${checkoutToken}`;
}
