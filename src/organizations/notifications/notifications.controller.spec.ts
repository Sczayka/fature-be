import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter.js';
import { TransformInterceptor } from '../../common/interceptors/transform.interceptor.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';

// PrismaService abre o pool do banco ao ser importado; o service é mockado
vi.mock('../../prisma/prisma.service.js', () => ({ PrismaService: class {} }));

const settings = {
  notifyInvoiceIssued: true,
  notifyInvoiceReminder: false,
  invoiceReminderDays: 5,
  notifyInvoiceOverdue: true,
  notifyInvoicePaid: true,
};

describe('Notification settings routes', () => {
  let app: INestApplication;
  let service: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    service = {
      get: vi.fn().mockResolvedValue(settings),
      update: vi.fn().mockImplementation((_orgId, dto) => dto),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [{ provide: NotificationsService, useValue: service }],
    }).compile();

    app = moduleRef.createNestApplication();
    // Sessão do Better Auth com a organização ativa
    app.use((req: any, _res: unknown, next: () => void) => {
      req.session = { activeOrganizationId: 'org-1' };
      next();
    });
    app.useGlobalInterceptors(new TransformInterceptor());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns the settings of the active organization', async () => {
    await request(app.getHttpServer())
      .get('/organizations/notifications')
      .expect(200, { success: true, data: settings });

    expect(service.get).toHaveBeenCalledWith('org-1');
  });

  it('saves the settings without extra fields', async () => {
    await request(app.getHttpServer())
      .put('/organizations/notifications')
      .send({ ...settings, contactEmail: 'x@y.com', name: 'Outra' })
      .expect(200);

    expect(service.update).toHaveBeenCalledWith('org-1', settings);
  });

  it('rejects invalid settings with the reasons', async () => {
    const response = await request(app.getHttpServer())
      .put('/organizations/notifications')
      .send({ ...settings, notifyInvoicePaid: 'sim', invoiceReminderDays: 0 })
      .expect(400);

    expect(response.body.error.details).toEqual(
      expect.arrayContaining([
        'Informe se a confirmação de pagamento é enviada',
        'O lembrete deve sair de 1 a 30 dias antes do vencimento',
      ]),
    );
    expect(service.update).not.toHaveBeenCalled();
  });
});
