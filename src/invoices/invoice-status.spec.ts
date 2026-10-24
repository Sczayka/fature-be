import {
  displayInvoiceStatus,
  invoiceStatusWhere,
  receivableInvoicesWhere,
} from './invoice-status.js';

const TODAY = '2026-10-15';
const START_OF_TODAY = new Date('2026-10-15T00:00:00Z');

/** Aplica o filtro como o banco faria, para comparar com o status exibido. */
function matches(
  where: ReturnType<typeof invoiceStatusWhere>,
  invoice: { status: string; dueDate: Date },
): boolean {
  if (where.OR)
    return where.OR.some((condition) => matches(condition, invoice));

  const status = where.status as string | { in: string[] };
  const dueDate = where.dueDate as { gte?: Date; lt?: Date } | undefined;

  return (
    (typeof status === 'string'
      ? invoice.status === status
      : status.in.includes(invoice.status)) &&
    (!dueDate?.gte || invoice.dueDate >= dueDate.gte) &&
    (!dueDate?.lt || invoice.dueDate < dueDate.lt)
  );
}

describe('displayInvoiceStatus', () => {
  it('shows an unpaid invoice past its due date as overdue', () => {
    expect(
      displayInvoiceStatus('PENDING', new Date('2026-10-14T00:00:00Z'), TODAY),
    ).toBe('OVERDUE');
  });

  it('shows an invoice marked overdue before its due date as pending', () => {
    // O PIX do checkout vence no fim do desconto e o provedor avisa o atraso dele
    expect(
      displayInvoiceStatus('OVERDUE', new Date('2026-10-20T00:00:00Z'), TODAY),
    ).toBe('PENDING');
    expect(
      displayInvoiceStatus('OVERDUE', new Date('2026-10-15T00:00:00Z'), TODAY),
    ).toBe('PENDING');
  });

  it('keeps the stored status of the other invoices', () => {
    const pastDue = new Date('2026-10-01T00:00:00Z');

    expect(displayInvoiceStatus('PAID', pastDue, TODAY)).toBe('PAID');
    expect(displayInvoiceStatus('CANCELLED', pastDue, TODAY)).toBe('CANCELLED');
    expect(displayInvoiceStatus('AWAITING_CONFIRMATION', pastDue, TODAY)).toBe(
      'AWAITING_CONFIRMATION',
    );
  });
});

describe('invoiceStatusWhere', () => {
  it('treats only unpaid invoices not yet due as pending', () => {
    expect(invoiceStatusWhere('PENDING', TODAY)).toEqual({
      status: { in: ['PENDING', 'OVERDUE'] },
      dueDate: { gte: START_OF_TODAY },
    });
  });

  it('treats unpaid invoices past their due date as overdue', () => {
    expect(invoiceStatusWhere('OVERDUE', TODAY)).toEqual({
      status: { in: ['PENDING', 'OVERDUE'] },
      dueDate: { lt: START_OF_TODAY },
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
    { status: 'OVERDUE', dueDate: '2026-10-10' },
    { status: 'AWAITING_CONFIRMATION', dueDate: '2026-10-10' },
    { status: 'PAID', dueDate: '2026-10-01' },
    { status: 'CANCELLED', dueDate: '2026-10-01' },
  ])(
    'puts a $status invoice due on $dueDate only under its displayed status',
    ({ status, dueDate }) => {
      const invoice = { status, dueDate: new Date(`${dueDate}T00:00:00Z`) };
      const displayed = displayInvoiceStatus(status, invoice.dueDate, TODAY);

      for (const filter of [
        'PENDING',
        'AWAITING_CONFIRMATION',
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

describe('receivableInvoicesWhere', () => {
  it.each([
    { status: 'PENDING', dueDate: '2026-10-15', receivable: true },
    { status: 'OVERDUE', dueDate: '2026-10-20', receivable: true },
    {
      status: 'AWAITING_CONFIRMATION',
      dueDate: '2026-10-01',
      receivable: true,
    },
    { status: 'PENDING', dueDate: '2026-10-14', receivable: false },
    { status: 'PAID', dueDate: '2026-11-01', receivable: false },
    { status: 'CANCELLED', dueDate: '2026-11-01', receivable: false },
  ])(
    'counts a $status invoice due on $dueDate as receivable: $receivable',
    ({ status, dueDate, receivable }) => {
      const invoice = { status, dueDate: new Date(`${dueDate}T00:00:00Z`) };

      expect(matches(receivableInvoicesWhere(TODAY), invoice)).toBe(receivable);
    },
  );
});
