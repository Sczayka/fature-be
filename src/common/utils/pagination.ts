/** Meta das listagens paginadas ({ data, meta }), no formato que o fature-fe lê. */
export function paginationMeta(
  page: number,
  limit: number,
  totalItems: number,
) {
  const totalPages = Math.ceil(totalItems / limit);

  return {
    page,
    per_page: limit,
    total_items: totalItems,
    total_pages: totalPages,
    has_next: page < totalPages,
    has_previous: page > 1,
  };
}

/** Dia inteiro (UTC) de uma data YYYY-MM-DD, como nos filtros "Criado em" das listagens. */
export function utcDayRange(date: string): { gte: Date; lte: Date } {
  const start = new Date(`${date}T00:00:00.000Z`);
  const end = new Date(`${date}T23:59:59.999Z`);

  return { gte: start, lte: end };
}
