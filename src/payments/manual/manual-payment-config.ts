import type { Prisma } from '@prisma/client';
import { PAYMENT_METHOD_LABELS } from '../../invoices/invoices.constants.js';
import type { PaymentMethod } from '../payments.constants.js';
import { PIX_MODE } from './manual-payments.constants.js';

/** Liberações do pagamento manual e os dados bancários que a empresa mostra no checkout. */
export const MANUAL_PAYMENT_CONFIG_SELECT = {
  bankTransferEnabled: true,
  pixMode: true,
  bankAccount: true,
} satisfies Prisma.OrganizationSelect;

export type ManualPaymentConfig = Prisma.OrganizationGetPayload<{
  select: typeof MANUAL_PAYMENT_CONFIG_SELECT;
}>;

/** Transferência liberada e com os dados para o pagador transferir. */
export function canReceiveBankTransfer(config: ManualPaymentConfig): boolean {
  const account = config.bankAccount;

  return (
    config.bankTransferEnabled &&
    !!account?.bankCode &&
    !!account.branch &&
    !!account.accountNumber &&
    !!account.accountType &&
    !!account.holderName &&
    !!account.holderDocument
  );
}

/** PIX com a chave da empresa: modo manual e chave cadastrada. */
export function usesManualPix(config: ManualPaymentConfig): boolean {
  return (
    isManualPixMode(config) &&
    !!config.bankAccount?.pixKeyType &&
    !!config.bankAccount.pixKey
  );
}

/** Modo manual, com ou sem chave: nesse modo o PIX nunca passa pelo provedor. */
export function isManualPixMode(config: ManualPaymentConfig): boolean {
  return config.pixMode === PIX_MODE.MANUAL;
}

/**
 * Fatura já paga em parte (ou com comprovante a conferir) por uma forma manual: as outras ficam de
 * fora, porque o desconto pode ser diferente entre as formas (lockedMethod do saldo).
 */
export function lockedMethodMessage(method: PaymentMethod): string {
  return `Esta fatura está sendo paga por ${PAYMENT_METHOD_LABELS[method]}. Envie o comprovante dessa forma.`;
}

/** Forma manual que a organização pode receber agora; as do provedor ficam de fora. */
export function isManualMethodAvailable(
  config: ManualPaymentConfig,
  method: PaymentMethod,
): boolean {
  switch (method) {
    case 'BANK_TRANSFER':
      return canReceiveBankTransfer(config);
    case 'PIX':
      return usesManualPix(config);
    default:
      return false;
  }
}
