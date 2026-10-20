import { NotFoundException } from '@nestjs/common';
import { NOTIFICATION_SETTINGS_SELECT } from './notifications.constants.js';
import { NotificationsService } from './notifications.service.js';

// PrismaService abre o pool do banco ao ser importado; os testes usam mocks
vi.mock('../../prisma/prisma.service.js', () => ({ PrismaService: class {} }));

const settings = {
  notifyInvoiceIssued: true,
  notifyInvoiceReminder: true,
  invoiceReminderDays: 3,
  notifyInvoiceOverdue: false,
  notifyInvoicePaid: true,
  notifyPaymentProofReceived: true,
  notifyPaymentProofRejected: false,
  notifyPartialPayment: true,
};

describe('NotificationsService', () => {
  let prisma: any;
  let service: NotificationsService;

  beforeEach(() => {
    prisma = {
      organization: {
        findUnique: vi.fn().mockResolvedValue(settings),
        update: vi.fn().mockImplementation(({ data }) => Promise.resolve(data)),
      },
    };
    service = new NotificationsService(prisma);
  });

  it('reads only the notification columns', async () => {
    await expect(service.get('org-1')).resolves.toEqual(settings);

    expect(prisma.organization.findUnique).toHaveBeenCalledWith({
      where: { id: 'org-1' },
      select: NOTIFICATION_SETTINGS_SELECT,
    });
  });

  it('fails when the organization does not exist', async () => {
    prisma.organization.findUnique.mockResolvedValue(null);

    await expect(service.get('org-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('saves every setting', async () => {
    await expect(service.update('org-1', settings)).resolves.toEqual(settings);

    expect(prisma.organization.update).toHaveBeenCalledWith({
      where: { id: 'org-1' },
      data: settings,
      select: NOTIFICATION_SETTINGS_SELECT,
    });
  });
});
