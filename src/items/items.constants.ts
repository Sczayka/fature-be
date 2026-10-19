import type { Prisma } from '@prisma/client';

export const ITEM_NOT_FOUND = 'Produto ou serviço não encontrado';

export const SERVICE_BRAND_MESSAGE =
  'Serviço não tem marca: a marca vale só para produtos';

/** Resultados da busca do autocomplete da fatura (GET /items/search). */
export const ITEM_SEARCH_LIMIT = 10;

/** Marca devolvida na lista e no detalhe do item. */
export const ITEM_BRAND_SELECT = {
  id: true,
  name: true,
  active: true,
} satisfies Prisma.BrandSelect;

/** Vínculo com o fornecedor; o nome e a situação vêm do cadastro dele. */
export const ITEM_SUPPLIER_SELECT = {
  supplierId: true,
  supplierCode: true,
  purchasePrice: true,
  isMain: true,
  supplier: { select: { name: true, active: true } },
} satisfies Prisma.ItemSupplierSelect;

/** O principal primeiro e os demais por nome. */
export const ITEM_SUPPLIER_ORDER = [
  { isMain: 'desc' },
  { supplier: { name: 'asc' } },
] satisfies Prisma.ItemSupplierOrderByWithRelationInput[];

export const ITEM_DETAIL_INCLUDE = {
  brand: { select: ITEM_BRAND_SELECT },
  suppliers: { select: ITEM_SUPPLIER_SELECT, orderBy: ITEM_SUPPLIER_ORDER },
} satisfies Prisma.ItemInclude;
