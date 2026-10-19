import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter.js';
import { TransformInterceptor } from '../common/interceptors/transform.interceptor.js';
import { ItemsController } from './items.controller.js';
import { ItemsService } from './items.service.js';

// PrismaService abre o pool do banco ao ser importado; o service é mockado
vi.mock('../prisma/prisma.service.js', () => ({ PrismaService: class {} }));

describe('Items routes', () => {
  let app: INestApplication;
  let service: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    service = {
      create: vi
        .fn()
        .mockImplementation((_orgId, dto) => ({ id: 'item-1', ...dto })),
      findAll: vi.fn().mockResolvedValue({ data: [], meta: { page: 1 } }),
      update: vi.fn().mockImplementation((id, _orgId, dto) => ({ id, ...dto })),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [ItemsController],
      providers: [{ provide: ItemsService, useValue: service }],
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

  it('reads the list filters and the pagination from the query', async () => {
    await request(app.getHttpServer())
      .get(
        '/items?page=2&limit=20&brandId=brand-1&supplierId=supplier-1&price=9.9&tab=x',
      )
      .expect(200);

    const [orgId, query] = service.findAll.mock.calls[0];

    expect(orgId).toBe('org-1');
    expect(query).toMatchObject({
      page: 2,
      limit: 20,
      brandId: 'brand-1',
      supplierId: 'supplier-1',
      price: 9.9,
    });
    expect(query).not.toHaveProperty('tab');
  });

  it('uses the first page of 10 items by default', async () => {
    await request(app.getHttpServer()).get('/items').expect(200);

    expect(service.findAll.mock.calls[0][1]).toMatchObject({
      page: 1,
      limit: 10,
    });
  });

  it('rejects pages of more than 100 items and invalid pages', async () => {
    const response = await request(app.getHttpServer())
      .get('/items?limit=500&page=0')
      .expect(400);

    expect(response.body.error.details).toEqual(
      expect.arrayContaining([
        'O limite por página deve ser de 1 a 100',
        'A página deve ser um número inteiro maior que zero',
      ]),
    );
    expect(service.findAll).not.toHaveBeenCalled();
  });

  it('validates the item before creating it', async () => {
    const response = await request(app.getHttpServer())
      .post('/items')
      .send({ name: 'Teclado', type: 'kit', price: -1 })
      .expect(400);

    expect(response.body.error.details).toEqual(
      expect.arrayContaining([
        'Tipo inválido: use product (produto) ou service (serviço)',
        'O preço deve ser maior que zero',
      ]),
    );
    expect(service.create).not.toHaveBeenCalled();
  });

  it('updates only the item fields of the contract', async () => {
    await request(app.getHttpServer())
      .put('/items/item-1')
      .send({ price: 10, organizationId: 'org-2', createdAt: '2020-01-01' })
      .expect(200);

    const [id, orgId, dto] = service.update.mock.calls[0];

    expect([id, orgId]).toEqual(['item-1', 'org-1']);
    expect(dto).toEqual({ price: 10 });
  });
});
