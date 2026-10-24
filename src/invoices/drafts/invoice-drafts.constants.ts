import type { Prisma } from '@prisma/client';

/**
 * Orçamentos que aparecem nas telas, no e-mail e no PDF: o convertido em cobrança fica guardado
 * só para a taxa de conversão do dashboard.
 */
export const OPEN_DRAFT = {
  convertedAt: null,
} satisfies Prisma.InvoiceDraftWhereInput;
