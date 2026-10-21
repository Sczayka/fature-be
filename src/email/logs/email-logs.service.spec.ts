import { EMAIL_LOG_SELECT } from '../email.constants.js';
import { EmailLogsService } from './email-logs.service.js';

// PrismaService abre o pool do banco ao ser importado; os testes usam mocks
vi.mock('../../prisma/prisma.service.js', () => ({ PrismaService: class {} }));

describe('EmailLogsService', () => {
  let prisma: any;
  let service: EmailLogsService;

  beforeEach(() => {
    prisma = {
      emailLog: {
        findMany: vi.fn().mockResolvedValue([{ id: 'log-1' }]),
        count: vi.fn().mockResolvedValue(21),
      },
    };
    service = new EmailLogsService(prisma);
  });

  it('lists the emails of a client of the organization, newest first, without the body', async () => {
    await expect(
      service.findAll('org-1', {
        clientId: 'client-1',
        invoiceId: null,
        page: 2,
        limit: 10,
      }),
    ).resolves.toEqual({
      data: [{ id: 'log-1' }],
      meta: {
        page: 2,
        per_page: 10,
        total_items: 21,
        total_pages: 3,
        has_next: true,
        has_previous: true,
      },
    });

    expect(prisma.emailLog.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', clientId: 'client-1' },
      orderBy: { createdAt: 'desc' },
      skip: 10,
      take: 10,
      select: EMAIL_LOG_SELECT,
    });
    expect(EMAIL_LOG_SELECT).not.toHaveProperty('html');
    expect(EMAIL_LOG_SELECT).not.toHaveProperty('text');
  });

  it('filters by invoice', async () => {
    await service.findAll('org-1', {
      clientId: null,
      invoiceId: 'inv-1',
      page: 1,
      limit: 10,
    });

    expect(prisma.emailLog.count).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', invoiceId: 'inv-1' },
    });
  });
});
