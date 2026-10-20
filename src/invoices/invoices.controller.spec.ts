import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ActiveGatewayGuard } from '../auth/active-gateway.guard.js';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter.js';
import { TransformInterceptor } from '../common/interceptors/transform.interceptor.js';
import { InvoicesController } from './invoices.controller.js';
import { InvoicesService } from './invoices.service.js';
import { CreateInvoiceDto } from './dto/create-invoice.dto.js';

// PrismaService abre o pool do banco ao ser importado; os testes usam mocks
vi.mock('../prisma/prisma.service.js', () => ({ PrismaService: class {} }));

describe('InvoicesController', () => {
  it('delegates the creation to the service with the active organization', async () => {
    const invoicesService = {
      create: vi.fn().mockResolvedValue({ id: 'inv-1' }),
    };
    const controller = new InvoicesController(invoicesService as any);
    const dto = {} as CreateInvoiceDto;

    await expect(controller.create('org-1', dto)).resolves.toEqual({
      id: 'inv-1',
    });
    expect(invoicesService.create).toHaveBeenCalledWith('org-1', dto);
  });
});

describe('Invoices routes', () => {
  const totals = {
    open: { count: 1, total: 100 },
    overdue: { count: 0, total: 0 },
    paid: { count: 2, total: 250.5 },
  };

  let app: INestApplication;
  let service: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    service = {
      findAll: vi.fn().mockResolvedValue({ data: [], meta: { page: 1 } }),
      totals: vi.fn().mockResolvedValue(totals),
      awaitingConfirmationCount: vi.fn().mockResolvedValue({ count: 2 }),
      findOne: vi.fn().mockResolvedValue({ id: 'inv-1' }),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [InvoicesController],
      providers: [{ provide: InvoicesService, useValue: service }],
    })
      .overrideGuard(ActiveGatewayGuard)
      .useValue({ canActivate: () => true })
      .compile();

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

  it('passes the client and status filters to the listing', async () => {
    await request(app.getHttpServer())
      .get('/invoices?clientId=client-1&status=OVERDUE&page=2')
      .expect(200);

    expect(service.findAll).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({
        page: 2,
        limit: 10,
        clientId: 'client-1',
        status: 'OVERDUE',
      }),
    );
  });

  it('rejects an unknown status and pages of more than 100 invoices', async () => {
    const response = await request(app.getHttpServer())
      .get('/invoices?status=LATE&limit=500')
      .expect(400);

    expect(response.body.error.details).toEqual(
      expect.arrayContaining([
        'Status inválido: use PENDING (pendente), AWAITING_CONFIRMATION (aguardando conferência), OVERDUE (vencida), PAID (paga) ou CANCELLED (cancelada)',
        'O limite por página deve ser de 1 a 100',
      ]),
    );
    expect(service.findAll).not.toHaveBeenCalled();
  });

  it('serves the totals of a client instead of the invoice detail', async () => {
    const response = await request(app.getHttpServer())
      .get('/invoices/totals?clientId=client-1')
      .expect(200);

    expect(response.body.data).toEqual(totals);
    expect(service.totals).toHaveBeenCalledWith('org-1', 'client-1');
    expect(service.findOne).not.toHaveBeenCalled();
  });

  it('sums the whole organization when no client is given', async () => {
    await request(app.getHttpServer()).get('/invoices/totals').expect(200);

    expect(service.totals).toHaveBeenCalledWith('org-1', null);
  });

  it('counts the invoices awaiting confirmation for the menu', async () => {
    await request(app.getHttpServer())
      .get('/invoices/awaiting-confirmation/count')
      .expect(200, { success: true, data: { count: 2 } });

    expect(service.awaitingConfirmationCount).toHaveBeenCalledWith('org-1');
    expect(service.findOne).not.toHaveBeenCalled();
  });

  it('accepts the awaiting confirmation status in the listing filter', async () => {
    await request(app.getHttpServer())
      .get('/invoices?status=AWAITING_CONFIRMATION')
      .expect(200);

    expect(service.findAll).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ status: 'AWAITING_CONFIRMATION' }),
    );
  });
});
