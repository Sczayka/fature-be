import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter.js';
import { TransformInterceptor } from '../common/interceptors/transform.interceptor.js';
import { SuppliersController } from './suppliers.controller.js';
import { SuppliersService } from './suppliers.service.js';

// PrismaService abre o pool do banco ao ser importado; o service é mockado
vi.mock('../prisma/prisma.service.js', () => ({ PrismaService: class {} }));

describe('Suppliers routes', () => {
  let app: INestApplication;
  let service: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    service = {
      create: vi
        .fn()
        .mockImplementation((_orgId, dto) => ({ id: 'supplier-1', ...dto })),
      findAll: vi.fn().mockResolvedValue({ data: [], meta: { page: 1 } }),
      search: vi.fn().mockResolvedValue([]),
      findOne: vi.fn().mockResolvedValue({ id: 'supplier-1' }),
      update: vi.fn().mockImplementation((id, _orgId, dto) => ({ id, ...dto })),
      remove: vi.fn().mockResolvedValue({ id: 'supplier-1' }),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [SuppliersController],
      providers: [{ provide: SuppliersService, useValue: service }],
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

  it('creates a supplier with the normalized data', async () => {
    await request(app.getHttpServer())
      .post('/suppliers')
      .send({
        name: 'Alfa',
        cpfCnpj: '529.982.247-25',
        paymentTermDays: [0, 30],
        contacts: [{ name: 'Ana' }],
      })
      .expect(201);

    expect(service.create).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({
        name: 'Alfa',
        cpfCnpj: '52998224725',
        paymentTermDays: [0, 30],
        contacts: [expect.objectContaining({ name: 'Ana' })],
      }),
    );
  });

  it('rejects an invalid supplier with the reasons', async () => {
    const response = await request(app.getHttpServer())
      .post('/suppliers')
      .send({ name: '', email: 'compras@', paymentTermDays: [90, 30] })
      .expect(400);

    expect(response.body.error.details).toEqual(
      expect.arrayContaining([
        'Informe o nome ou a razão social',
        'E-mail inválido',
        'As parcelas do prazo de pagamento devem estar em ordem crescente, sem repetir dias',
      ]),
    );
    expect(service.create).not.toHaveBeenCalled();
  });

  it('reads the list filters, with the document without punctuation', async () => {
    await request(app.getHttpServer())
      .get('/suppliers?cpfCnpj=11.222&active=true&limit=50')
      .expect(200);

    expect(service.findAll.mock.calls[0][1]).toMatchObject({
      page: 1,
      limit: 50,
      cpfCnpj: '11222',
      active: true,
    });
  });

  it('searches with the brand of the product', async () => {
    await request(app.getHttpServer())
      .get('/suppliers/search?q=alfa&brandId=brand-1')
      .expect(200);
    await request(app.getHttpServer()).get('/suppliers/search').expect(200);

    expect(service.search.mock.calls).toEqual([
      ['org-1', 'alfa', 'brand-1'],
      ['org-1', '', undefined],
    ]);
  });

  it('routes the detail, the update and the delete to the active organization', async () => {
    await request(app.getHttpServer()).get('/suppliers/supplier-1').expect(200);
    await request(app.getHttpServer())
      .put('/suppliers/supplier-1')
      .send({ active: false })
      .expect(200);
    await request(app.getHttpServer())
      .delete('/suppliers/supplier-1')
      .expect(200);

    expect(service.findOne).toHaveBeenCalledWith('supplier-1', 'org-1');
    expect(service.update).toHaveBeenCalledWith('supplier-1', 'org-1', {
      active: false,
    });
    expect(service.remove).toHaveBeenCalledWith('supplier-1', 'org-1');
  });

  it('answers 403 without an active organization', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [SuppliersController],
      providers: [{ provide: SuppliersService, useValue: service }],
    }).compile();
    const appWithoutOrganization = moduleRef.createNestApplication();

    appWithoutOrganization.useGlobalFilters(new HttpExceptionFilter());
    await appWithoutOrganization.init();

    await request(appWithoutOrganization.getHttpServer())
      .get('/suppliers')
      .expect(403);
    expect(service.findAll).not.toHaveBeenCalled();

    await appWithoutOrganization.close();
  });
});
