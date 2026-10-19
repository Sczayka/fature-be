import { EmailSchedulerService } from './email-scheduler.service.js';

// PrismaService abre o pool do banco ao ser importado; os testes usam mocks
vi.mock('../../prisma/prisma.service.js', () => ({ PrismaService: class {} }));

// 08:00 em São Paulo
const NOW = new Date('2026-10-18T11:00:00Z');
const TODAY = '2026-10-18';

describe('EmailSchedulerService', () => {
  let prisma: any;
  let outbox: any;
  let invoiceEmails: any;
  let scheduler: EmailSchedulerService;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);

    prisma = {
      organization: {
        groupBy: vi
          .fn()
          .mockResolvedValue([
            { invoiceReminderDays: 3 },
            { invoiceReminderDays: 7 },
          ]),
      },
      invoice: { findMany: vi.fn().mockResolvedValue([]) },
    };
    outbox = {
      processDue: vi.fn().mockResolvedValue(0),
      purgeBodies: vi.fn().mockResolvedValue(0),
    };
    invoiceEmails = {
      sendAutomatic: vi
        .fn()
        .mockResolvedValue({ id: 'log-1', status: 'QUEUED' }),
    };
    scheduler = new EmailSchedulerService(prisma, outbox, invoiceEmails);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  describe('runDaily', () => {
    it('queues the reminders of each reminder setting', async () => {
      prisma.invoice.findMany
        .mockResolvedValueOnce([{ id: 'inv-3' }])
        .mockResolvedValueOnce([{ id: 'inv-7' }])
        .mockResolvedValueOnce([]);

      await expect(scheduler.runDaily(TODAY)).resolves.toMatchObject({
        reminders: 2,
        overdue: 0,
      });

      expect(prisma.organization.groupBy).toHaveBeenCalledWith({
        by: ['invoiceReminderDays'],
        where: { notifyInvoiceReminder: true },
      });
      expect(prisma.invoice.findMany.mock.calls[0][0].where).toEqual({
        dueDate: {
          gte: new Date('2026-10-21T00:00:00Z'),
          lt: new Date('2026-10-22T00:00:00Z'),
        },
        status: { notIn: ['PAID', 'CANCELLED'] },
        createdAt: { lt: new Date('2026-10-17T11:00:00Z') },
        organization: { notifyInvoiceReminder: true, invoiceReminderDays: 3 },
        emailLogs: { none: { type: 'INVOICE_REMINDER' } },
      });
      expect(prisma.invoice.findMany.mock.calls[1][0].where.dueDate).toEqual({
        gte: new Date('2026-10-25T00:00:00Z'),
        lt: new Date('2026-10-26T00:00:00Z'),
      });
      expect(invoiceEmails.sendAutomatic).toHaveBeenCalledWith(
        'inv-3',
        'INVOICE_REMINDER',
        { deliverNow: false, today: TODAY },
      );
    });

    it('queues the overdue notice only for invoices that are due in the last days', async () => {
      prisma.organization.groupBy.mockResolvedValue([]);
      prisma.invoice.findMany.mockResolvedValue([{ id: 'inv-1' }]);

      await expect(scheduler.runDaily(TODAY)).resolves.toMatchObject({
        overdue: 1,
      });

      expect(prisma.invoice.findMany).toHaveBeenCalledWith({
        where: {
          dueDate: {
            gte: new Date('2026-10-15T00:00:00Z'),
            lt: new Date('2026-10-18T00:00:00Z'),
          },
          status: { notIn: ['PAID', 'CANCELLED'] },
          organization: { notifyInvoiceOverdue: true },
          emailLogs: { none: { type: 'INVOICE_OVERDUE' } },
        },
        select: { id: true },
      });
      expect(invoiceEmails.sendAutomatic).toHaveBeenCalledWith(
        'inv-1',
        'INVOICE_OVERDUE',
        { deliverNow: false, today: TODAY },
      );
    });

    it('does not count skipped emails and keeps going after a failure', async () => {
      prisma.organization.groupBy.mockResolvedValue([]);
      prisma.invoice.findMany.mockResolvedValue([
        { id: 'inv-1' },
        { id: 'inv-2' },
        { id: 'inv-3' },
      ]);
      invoiceEmails.sendAutomatic
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce({ id: 'log-2', status: 'SKIPPED' })
        .mockResolvedValueOnce({ id: 'log-3', status: 'QUEUED' });

      await expect(scheduler.runDaily(TODAY)).resolves.toMatchObject({
        overdue: 1,
      });
      expect(invoiceEmails.sendAutomatic).toHaveBeenCalledTimes(3);
    });

    it('purges the body of emails finished more than 30 days ago', async () => {
      await scheduler.runDaily(TODAY);

      expect(outbox.purgeBodies).toHaveBeenCalledWith(
        new Date('2026-09-18T11:00:00Z'),
      );
    });
  });

  describe('reconcile', () => {
    it('recovers issued and paid emails that the events did not register', async () => {
      prisma.invoice.findMany
        .mockResolvedValueOnce([{ id: 'inv-issued' }])
        .mockResolvedValueOnce([{ id: 'inv-paid' }]);

      await expect(scheduler.reconcile(NOW)).resolves.toBe(2);

      const window = {
        gte: new Date('2026-10-18T09:00:00Z'),
        lte: new Date('2026-10-18T10:58:00Z'),
      };

      expect(prisma.invoice.findMany.mock.calls[0][0].where).toEqual({
        createdAt: window,
        status: { not: 'CANCELLED' },
        organization: { notifyInvoiceIssued: true },
        emailLogs: { none: { type: 'INVOICE_ISSUED' } },
      });
      expect(prisma.invoice.findMany.mock.calls[1][0].where).toEqual({
        status: 'PAID',
        updatedAt: window,
        organization: { notifyInvoicePaid: true },
        emailLogs: { none: { type: 'INVOICE_PAID' } },
      });
      expect(invoiceEmails.sendAutomatic).toHaveBeenCalledWith(
        'inv-paid',
        'INVOICE_PAID',
        { deliverNow: false, today: TODAY },
      );
    });
  });

  describe('drain', () => {
    it('does not run twice at the same time', async () => {
      let release: (count: number) => void = () => undefined;

      outbox.processDue.mockReturnValue(
        new Promise<number>((resolve) => {
          release = resolve;
        }),
      );

      const first = scheduler.drain();

      await expect(scheduler.drain()).resolves.toBe(0);

      release(3);

      await expect(first).resolves.toBe(3);
      expect(outbox.processDue).toHaveBeenCalledTimes(1);
    });
  });

  it('turns the routines off with EMAIL_WORKERS_ENABLED=false', async () => {
    vi.stubEnv('EMAIL_WORKERS_ENABLED', 'false');

    await scheduler.handleDaily();
    await scheduler.handleDrain();
    await scheduler.handleReconcile();

    expect(prisma.organization.groupBy).not.toHaveBeenCalled();
    expect(outbox.processDue).not.toHaveBeenCalled();
    expect(prisma.invoice.findMany).not.toHaveBeenCalled();
  });
});
