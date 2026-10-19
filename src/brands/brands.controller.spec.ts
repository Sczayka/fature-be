import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter.js';
import { TransformInterceptor } from '../common/interceptors/transform.interceptor.js';
import { BrandsController } from './brands.controller.js';
import { BrandsService } from './brands.service.js';

// PrismaService abre o pool do banco ao ser importado; o service é mockado
vi.mock('../prisma/prisma.service.js', () => ({ PrismaService: class {} }));

describe('Brands routes', () => {
  let app: INestApplication;
  let service: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    service = {
      create: vi
        .fn()
        .mockImplementation((_orgId, dto) => ({ id: 'brand-1', ...dto })),
      findAll: vi.fn().mockResolvedValue({ data: [], meta: { page: 1 } }),
      search: vi
        .fn()
        .mockResolvedValue([{ id: 'brand-1', name: 'Logitech', active: true }]),
      update: vi.fn().mockImplementation((id, _orgId, dto) => ({ id, ...dto })),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [BrandsController],
      providers: [{ provide: BrandsService, useValue: service }],
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

  it('creates a brand with the trimmed name', async () => {
    await request(app.getHttpServer())
      .post('/brands')
      .send({ name: '  Logitech ', organizationId: 'org-2' })
      .expect(201);

    expect(service.create).toHaveBeenCalledWith('org-1', { name: 'Logitech' });
  });

  it('requires the name', async () => {
    const response = await request(app.getHttpServer())
      .post('/brands')
      .send({ name: '   ' })
      .expect(400);

    expect(response.body.error.details).toContain('Informe o nome da marca');
    expect(service.create).not.toHaveBeenCalled();
  });

  it('reads the status filter as a boolean', async () => {
    await request(app.getHttpServer())
      .get('/brands?active=false&name=log')
      .expect(200);

    expect(service.findAll.mock.calls[0][1]).toMatchObject({
      page: 1,
      limit: 10,
      name: 'log',
      active: false,
    });
  });

  it('rejects an unknown status', async () => {
    await request(app.getHttpServer()).get('/brands?active=sim').expect(400);

    expect(service.findAll).not.toHaveBeenCalled();
  });

  it('searches with the trimmed text, or without text', async () => {
    await request(app.getHttpServer())
      .get('/brands/search?q=%20log%20')
      .expect(200, {
        success: true,
        data: [{ id: 'brand-1', name: 'Logitech', active: true }],
      });
    await request(app.getHttpServer()).get('/brands/search').expect(200);

    expect(service.search.mock.calls).toEqual([
      ['org-1', 'log'],
      ['org-1', ''],
    ]);
  });

  it('inactivates a brand without requiring the name', async () => {
    await request(app.getHttpServer())
      .put('/brands/brand-1')
      .send({ active: false })
      .expect(200);

    expect(service.update).toHaveBeenCalledWith('brand-1', 'org-1', {
      active: false,
    });
  });

  it('rejects null in the name and in the status', async () => {
    await request(app.getHttpServer())
      .put('/brands/brand-1')
      .send({ name: null, active: null })
      .expect(400);

    expect(service.update).not.toHaveBeenCalled();
  });
});
