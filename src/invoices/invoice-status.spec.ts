import { displayInvoiceStatus, invoiceStatusWhere } from './invoice-status.js';

const TODAY = '2026-10-15';
const START_OF_TODAY = new Date('2026-10-15T00:00:00Z');

/** Aplica o filtro como o banco faria, para comparar com o status exibido. */
function matches(
  where: ReturnType<typeof invoiceStatusWhere>,
  invoice: { status: string; dueDate: Date },
): boolean {
  if (where.OR)
    return where.OR.some((condition) => matches(condition, invoice));

  const dueDate = where.dueDate as { gte?: Date; lt?: Date } | undefined;

  return (
    invoice.status === where.status &&
    (!dueDate?.gte || invoice.dueDate >= dueDate.gte) &&
    (!dueDate?.lt || invoice.dueDate < dueDate.lt)
  );
}

describe('invoiceStatusWhere', () => {
  it('treats only pending invoices not yet due as pending', () => {
    expect(invoiceStatusWhere('PENDING', TODAY)).toEqual({
      status: 'PENDING',
      dueDate: { gte: START_OF_TODAY },
    });
  });

  it('includes pending invoices past their due date as overdue', () => {
    expect(invoiceStatusWhere('OVERDUE', TODAY)).toEqual({
      OR: [
        { status: 'OVERDUE' },
        { status: 'PENDING', dueDate: { lt: START_OF_TODAY } },
      ],
    });
  });

  it('filters paid and cancelled invoices by the stored status', () => {
    expect(invoiceStatusWhere('PAID', TODAY)).toEqual({ status: 'PAID' });
    expect(invoiceStatusWhere('CANCELLED', TODAY)).toEqual({
      status: 'CANCELLED',
    });
  });

  it.each([
    { status: 'PENDING', dueDate: '2026-10-15' },
    { status: 'PENDING', dueDate: '2026-10-14' },
    { status: 'PENDING', dueDate: '2026-11-30' },
    // O provedor pode marcar como vencida antes da data (PIX expirado)
    { status: 'OVERDUE', dueDate: '2026-10-20' },
    { status: 'PAID', dueDate: '2026-10-01' },
    { status: 'CANCELLED', dueDate: '2026-10-01' },
  ])(
    'puts a $status invoice due on $dueDate only under its displayed status',
    ({ status, dueDate }) => {
      const invoice = { status, dueDate: new Date(`${dueDate}T00:00:00Z`) };
      const displayed = displayInvoiceStatus(status, invoice.dueDate, TODAY);

      for (const filter of [
        'PENDING',
        'OVERDUE',
        'PAID',
        'CANCELLED',
      ] as const) {
        expect(matches(invoiceStatusWhere(filter, TODAY), invoice)).toBe(
          filter === displayed,
        );
      }
    },
  );
});
