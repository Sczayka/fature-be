import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter.js';
import { TransformInterceptor } from '../common/interceptors/transform.interceptor.js';
import { StockMovementsController } from './stock-movements.controller.js';
import { StockService } from './stock.service.js';

// PrismaService abre o pool do banco ao ser importado; o service é mockado
vi.mock('../prisma/prisma.service.js', () => ({ PrismaService: class {} }));

describe('Stock movements routes', () => {
  let app: INestApplication;
  let service: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    service = {
      findMovements: vi.fn().mockResolvedValue({ data: [], meta: {} }),
      createMovement: vi
        .fn()
        .mockImplementation((itemId, _orgId, _userId, dto) => ({
          id: 'movement-1',
          itemId,
          ...dto,
        })),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [StockMovementsController],
      providers: [{ provide: StockService, useValue: service }],
    }).compile();

    app = moduleRef.createNestApplication();
    // Sessão do Better Auth com a organização ativa e o usuário
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

  it('lists the movements of the item with the pagination of the query', async () => {
    await request(app.getHttpServer())
      .get('/items/item-1/stock-movements?page=2&limit=20')
      .expect(200);

    expect(service.findMovements).toHaveBeenCalledWith(
      'item-1',
      'org-1',
      expect.objectContaining({ page: 2, limit: 20 }),
    );
  });

  it('records the movement with the user as the author', async () => {
    await request(app.getHttpServer())
      .post('/items/item-1/stock-movements')
      .send({ type: 'ENTRY', quantity: 4, createdById: 'user-2' })
      .expect(201);

    expect(service.createMovement).toHaveBeenCalledWith(
      'item-1',
      'org-1',
      'user-1',
      { type: 'ENTRY', quantity: 4 },
    );
  });

  it('validates the movement before recording it', async () => {
    const response = await request(app.getHttpServer())
      .post('/items/item-1/stock-movements')
      .send({ type: 'ADJUSTMENT', balance: 3 })
      .expect(400);

    expect(response.body.error.details).toContain('Informe o motivo do ajuste');
    expect(service.createMovement).not.toHaveBeenCalled();
  });
});
