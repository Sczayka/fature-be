import type { Prisma } from '@prisma/client';
import { PAYMENT_METHODS } from '../payments/payments.constants.js';

/** Banco, conta no provedor de pagamento (a do Fature é criada pelo sistema) e dinheiro. */
export const FINANCIAL_ACCOUNT_TYPE = {
  BANK: 'BANK',
  PAYMENT_PROVIDER: 'PAYMENT_PROVIDER',
  CASH: 'CASH',
} as const;

export type FinancialAccountType =
  (typeof FINANCIAL_ACCOUNT_TYPE)[keyof typeof FINANCIAL_ACCOUNT_TYPE];

export const FINANCIAL_ACCOUNT_TYPES = Object.values(FINANCIAL_ACCOUNT_TYPE);

/** Sentido do dinheiro: IN entra na conta, OUT sai. O valor é sempre positivo. */
export const ENTRY_DIRECTION = {
  IN: 'IN',
  OUT: 'OUT',
} as const;

export type EntryDirection =
  (typeof ENTRY_DIRECTION)[keyof typeof ENTRY_DIRECTION];

export const ENTRY_DIRECTIONS = Object.values(ENTRY_DIRECTION);

/** Quem criou: a empresa, a movimentação da fatura (sincronizada) ou a transferência entre contas. */
export const ENTRY_ORIGIN = {
  MANUAL: 'MANUAL',
  INVOICE: 'INVOICE',
  TRANSFER: 'TRANSFER',
} as const;

export type EntryOrigin = (typeof ENTRY_ORIGIN)[keyof typeof ENTRY_ORIGIN];

/** Origens que aparecem nos recebimentos: os da empresa e os das faturas. */
export const RECEIPT_ORIGINS = [ENTRY_ORIGIN.MANUAL, ENTRY_ORIGIN.INVOICE];

/** Contas a pagar: as saídas lançadas pela empresa (de fornecedor, da folha ou avulsas). */
export const PAYABLE_ENTRY = {
  origin: ENTRY_ORIGIN.MANUAL,
  direction: ENTRY_DIRECTION.OUT,
} satisfies Prisma.FinancialEntryWhereInput;

/**
 * Em aberto (só as contas a pagar), pago ou recebido, e cancelado (a movimentação da fatura foi
 * cancelada). Só PAID entra no saldo.
 */
export const ENTRY_STATUS = {
  PENDING: 'PENDING',
  PAID: 'PAID',
  CANCELLED: 'CANCELLED',
} as const;

export type EntryStatus = (typeof ENTRY_STATUS)[keyof typeof ENTRY_STATUS];

/** Formas dos lançamentos: as das faturas, mais dinheiro e cheque. */
export const ENTRY_PAYMENT_METHODS = [
  ...PAYMENT_METHODS,
  'CASH',
  'CHECK',
] as const;

export type EntryPaymentMethod = (typeof ENTRY_PAYMENT_METHODS)[number];

/** Contas a pagar criadas juntas: parcelas de uma compra ou recorrência mensal. */
export const SERIES_TYPE = {
  INSTALLMENTS: 'INSTALLMENTS',
  RECURRING: 'RECURRING',
} as const;

export type SeriesType = (typeof SERIES_TYPE)[keyof typeof SERIES_TYPE];

export const SERIES_TYPES = Object.values(SERIES_TYPE);

/** Parcelas ou meses de uma série, gerados de uma vez. */
export const SERIES_MAX_SIZE = 60;

/** Pagamentos da folha. Os encargos (INSS, FGTS e IRRF) não são calculados. */
export const PAYROLL_TYPES = [
  'SALARY',
  'ADVANCE',
  'THIRTEENTH',
  'VACATION',
  'BONUS',
  'OTHER',
] as const;

export type PayrollType = (typeof PAYROLL_TYPES)[number];

/** Nome dos pagamentos na descrição gerada pela folha (ex.: "Salário 10/2026"). */
export const PAYROLL_TYPE_LABELS: Record<PayrollType, string> = {
  SALARY: 'Salário',
  ADVANCE: 'Adiantamento',
  THIRTEENTH: '13º salário',
  VACATION: 'Férias',
  BONUS: 'Bônus',
  OTHER: 'Pagamento',
};

/** Mês de referência da folha (YYYY-MM). */
export const COMPETENCE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Teto de um valor: a coluna guarda 10 dígitos antes da vírgula. */
export const FINANCIAL_AMOUNT_MAX = 999_999_999.99;

export const ENTRY_DESCRIPTION_MAX_LENGTH = 200;
export const ENTRY_DOCUMENT_MAX_LENGTH = 60;
export const FINANCIAL_NOTES_MAX_LENGTH = 500;
export const FINANCIAL_ACCOUNT_NAME_MAX_LENGTH = 80;
export const FINANCIAL_CATEGORY_NAME_MAX_LENGTH = 60;

/** Período máximo do extrato, em dias. */
export const STATEMENT_MAX_DAYS = 366;

/** Resultados da busca de funcionários para os seletores. */
export const EMPLOYEE_SEARCH_LIMIT = 10;

/** Configuração padrão (setupOrganizationFinancial). */
export const DEFAULT_MAIN_ACCOUNT_NAME = 'Conta bancária';
export const DEFAULT_CASH_ACCOUNT_NAME = 'Dinheiro';
/** Conta da organização no provedor: para ela, é a conta de recebimentos do Fature. */
export const PROVIDER_ACCOUNT_NAME = 'Conta Fature';

export const DEFAULT_CATEGORIES: Record<EntryDirection, string[]> = {
  IN: ['Vendas e serviços', 'Rendimentos', 'Outras receitas'],
  OUT: [
    'Fornecedores e mercadorias',
    'Aluguel e condomínio',
    'Água, luz e internet',
    'Salários e encargos',
    'Impostos e taxas',
    'Tarifas bancárias',
    'Marketing',
    'Serviços contratados',
    'Outras despesas',
  ],
};

export const FINANCIAL_ACCOUNT_NOT_FOUND = 'Conta não encontrada';
export const FINANCIAL_CATEGORY_NOT_FOUND = 'Categoria não encontrada';
export const FINANCIAL_ENTRY_NOT_FOUND = 'Lançamento não encontrado';
export const EMPLOYEE_NOT_FOUND = 'Funcionário não encontrado';

const NAME_SELECT = { select: { id: true, name: true } } as const;

/** Lançamento como as telas mostram: os vínculos só com o nome. */
export const FINANCIAL_ENTRY_SELECT = {
  id: true,
  direction: true,
  origin: true,
  status: true,
  description: true,
  amount: true,
  dueDate: true,
  paidAmount: true,
  feeAmount: true,
  paymentDate: true,
  settlementDate: true,
  paymentMethod: true,
  account: { select: { id: true, name: true, type: true } },
  category: NAME_SELECT,
  documentNumber: true,
  notes: true,
  supplier: NAME_SELECT,
  supplierBankAccountId: true,
  employee: NAME_SELECT,
  payrollType: true,
  competence: true,
  seriesId: true,
  seriesType: true,
  seriesIndex: true,
  seriesSize: true,
  invoiceId: true,
  client: NAME_SELECT,
  transferId: true,
  createdBy: NAME_SELECT,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.FinancialEntrySelect;

export type FinancialEntryRow = Prisma.FinancialEntryGetPayload<{
  select: typeof FINANCIAL_ENTRY_SELECT;
}>;
