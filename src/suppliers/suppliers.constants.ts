import type { Prisma } from '@prisma/client';

/** Conta corrente ou poupança. */
export const BANK_ACCOUNT_TYPES = ['CHECKING', 'SAVINGS'] as const;

export type BankAccountType = (typeof BANK_ACCOUNT_TYPES)[number];

/** EVP é a chave aleatória. */
export const PIX_KEY_TYPES = ['CPF', 'CNPJ', 'EMAIL', 'PHONE', 'EVP'] as const;

export type PixKeyType = (typeof PIX_KEY_TYPES)[number];

/** Resultados da busca para os seletores (GET /suppliers/search). */
export const SUPPLIER_SEARCH_LIMIT = 10;

export const SUPPLIER_NOT_FOUND = 'Fornecedor não encontrado';

/** Formatos gravados dos dados bancários (os DTOs tiram a pontuação antes de conferir). */
export const BANK_CODE_PATTERN = /^\d{3}$/;
/** Agência com o dígito opcional ("1234", "1234-5"). */
export const BRANCH_PATTERN = /^\d{1,5}(-?[\dX])?$/;
/** Conta com o dígito ("12345-6", "123456" ou "12345-X"). */
export const ACCOUNT_NUMBER_PATTERN = /^\d{1,19}-?[\dX]$/;

/** Campos da listagem e da busca: contatos e dados bancários só saem no detalhe. */
export const SUPPLIER_SUMMARY_SELECT = {
  id: true,
  name: true,
  tradeName: true,
  email: true,
  phone: true,
  mobile: true,
  cpfCnpj: true,
  municipalInscription: true,
  stateInscription: true,
  cep: true,
  addressLine: true,
  addressNumber: true,
  complement: true,
  district: true,
  state: true,
  city: true,
  paymentTermDays: true,
  notes: true,
  active: true,
  organizationId: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.SupplierSelect;

const SUPPLIER_CONTACT_SELECT = {
  id: true,
  name: true,
  role: true,
  email: true,
  phone: true,
  mobile: true,
  isMain: true,
} satisfies Prisma.SupplierContactSelect;

const SUPPLIER_BANK_ACCOUNT_SELECT = {
  id: true,
  bankCode: true,
  bankName: true,
  branch: true,
  accountNumber: true,
  accountType: true,
  holderName: true,
  holderDocument: true,
  pixKeyType: true,
  pixKey: true,
  isMain: true,
} satisfies Prisma.SupplierBankAccountSelect;

/** Linhas gravadas na mesma transação têm o mesmo createdAt; o cuid desempata na ordem de criação. */
const CREATION_ORDER = [{ createdAt: 'asc' }, { id: 'asc' }] as const;

/** Detalhe: marcas que fornece, contatos e contas, na ordem em que foram cadastrados. */
export const SUPPLIER_DETAIL_SELECT = {
  ...SUPPLIER_SUMMARY_SELECT,
  brands: {
    select: { brand: { select: { id: true, name: true, active: true } } },
    orderBy: { brand: { name: 'asc' } },
  },
  contacts: { select: SUPPLIER_CONTACT_SELECT, orderBy: [...CREATION_ORDER] },
  bankAccounts: {
    select: SUPPLIER_BANK_ACCOUNT_SELECT,
    orderBy: [...CREATION_ORDER],
  },
} satisfies Prisma.SupplierSelect;
