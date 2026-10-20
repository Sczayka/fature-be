import type { Prisma } from '@prisma/client';

/** Dados que a empresa mostra no checkout (sem a organização e a data de alteração). */
export const BANK_ACCOUNT_SELECT = {
  bankCode: true,
  bankName: true,
  branch: true,
  accountNumber: true,
  accountType: true,
  holderName: true,
  holderDocument: true,
  pixKeyType: true,
  pixKey: true,
} satisfies Prisma.OrganizationBankAccountSelect;

/** Aba "Dados bancários": as liberações do admin do Fature e a conta (null antes do 1º cadastro). */
export const BANK_ACCOUNT_SETTINGS_SELECT = {
  bankTransferEnabled: true,
  pixMode: true,
  bankAccount: { select: BANK_ACCOUNT_SELECT },
} satisfies Prisma.OrganizationSelect;

export type BankAccountSettings = Prisma.OrganizationGetPayload<{
  select: typeof BANK_ACCOUNT_SETTINGS_SELECT;
}>;

export type BankAccountData = Prisma.OrganizationBankAccountGetPayload<{
  select: typeof BANK_ACCOUNT_SELECT;
}>;

export const MANUAL_PAYMENT_NOT_RELEASED =
  'Pagamento manual não liberado para esta empresa.';
