import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter.js';
import { TransformInterceptor } from '../../common/interceptors/transform.interceptor.js';
import { InvoiceEmailsController } from './invoice-emails.controller.js';
import { InvoiceEmailsService } from './invoice-emails.service.js';

// PrismaService abre o pool do banco ao ser importado; o service é mockado
vi.mock('../../prisma/prisma.service.js', () => ({ PrismaService: class {} }));

describe('Invoice email routes', () => {
  let app: INestApplication;
  let service: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    service = {
      sendManual: vi.fn().mockResolvedValue({ id: 'log-1', status: 'SENT' }),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [InvoiceEmailsController],
      providers: [{ provide: InvoiceEmailsService, useValue: service }],
    }).compile();

    app = moduleRef.createNestApplication();
    // Sessão do Better Auth com a organização ativa
    app.use((req: any, _res: unknown, next: () => void) => {
      req.session = { activeOrganizationId: 'org-1' };
      req.user = { id: 'user-1' };
      next();
    });
    app.useGlobalInterceptors(new TransformInterceptor());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('sends the invoice to the client email', async () => {
    await request(app.getHttpServer())
      .post('/invoices/inv-1/emails')
      .send({})
      .expect(201, { success: true, data: { id: 'log-1', status: 'SENT' } });

    expect(service.sendManual).toHaveBeenCalledWith('org-1', 'inv-1', {
      to: null,
      requestedBy: 'user-1',
    });
  });

  it('sends to the informed address', async () => {
    await request(app.getHttpServer())
      .post('/invoices/inv-1/emails')
      .send({ to: ' financeiro@cliente.com ' })
      .expect(201);

    expect(service.sendManual.mock.calls[0][2].to).toBe(
      'financeiro@cliente.com',
    );
  });

  it('rejects an invalid address', async () => {
    const response = await request(app.getHttpServer())
      .post('/invoices/inv-1/emails')
      .send({ to: 'financeiro@' })
      .expect(400);

    expect(response.body.error.details).toContain(
      'E-mail do destinatário inválido',
    );
    expect(service.sendManual).not.toHaveBeenCalled();
  });
});
