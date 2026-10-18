import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter.js';
import { TransformInterceptor } from '../../common/interceptors/transform.interceptor.js';
import { CustomizationController } from './customization.controller.js';
import { CustomizationService } from './customization.service.js';
import { LOGO_MAX_BYTES } from './customization.constants.js';
import { LogosController } from './logos.controller.js';

// PrismaService abre o pool do banco ao ser importado; o service é mockado
vi.mock('../../prisma/prisma.service.js', () => ({ PrismaService: class {} }));

/** PNG de 1x1 px. */
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d4948445200000001000000010806000000' +
    '1f15c4890000000d49444154789c63f8ffff3f0005fe02fea7d6a4ab00' +
    '00000049454e44ae426082',
  'hex',
);

describe('Customization routes', () => {
  let app: INestApplication;
  let service: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    service = {
      get: vi.fn(),
      update: vi.fn().mockImplementation((_orgId, dto) => dto),
      uploadLogo: vi
        .fn()
        .mockResolvedValue({ logo: 'https://api/logos/org-1?v=1' }),
      removeLogo: vi.fn().mockResolvedValue({ logo: null }),
      findLogo: vi.fn().mockResolvedValue({
        data: new Uint8Array(PNG),
        mimeType: 'image/png',
      }),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [CustomizationController, LogosController],
      providers: [{ provide: CustomizationService, useValue: service }],
    })
      .overrideGuard(ThrottlerGuard)
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

  it('saves the customization with the URL and the colors normalized', async () => {
    const response = await request(app.getHttpServer())
      .put('/organizations/customization')
      .send({
        slug: ' Raipp-Studio ',
        wallpaper: 'WAVES',
        backgroundColor: '#9DB4DC',
        buttonColor: null,
      })
      .expect(200);

    expect(service.update).toHaveBeenCalledWith('org-1', {
      slug: 'raipp-studio',
      wallpaper: 'WAVES',
      backgroundColor: '#9db4dc',
      buttonColor: null,
    });
    expect(response.body.success).toBe(true);
  });

  it('rejects an invalid customization with the reasons', async () => {
    const response = await request(app.getHttpServer())
      .put('/organizations/customization')
      .send({
        slug: 'raipp studio',
        wallpaper: 'STARS',
        backgroundColor: 'red',
      })
      .expect(400);

    expect(response.body.error.details).toEqual(
      expect.arrayContaining([
        'URL inválida: use letras minúsculas, números e hífens',
        'Papel de parede inválido',
        'Cor de fundo inválida: use o formato #RRGGBB',
        'Cor do botão inválida: use o formato #RRGGBB',
      ]),
    );
    expect(service.update).not.toHaveBeenCalled();
  });

  it('uploads a logo checked by its bytes', async () => {
    await request(app.getHttpServer())
      .put('/organizations/customization/logo')
      .attach('file', PNG, { filename: 'logo.png', contentType: 'image/png' })
      .expect(200, {
        success: true,
        data: { logo: 'https://api/logos/org-1?v=1' },
      });

    expect(service.uploadLogo).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ mimetype: 'image/png', buffer: PNG }),
    );
  });

  it('rejects a file that is not an image even when named as one', async () => {
    const response = await request(app.getHttpServer())
      .put('/organizations/customization/logo')
      .attach('file', Buffer.from('<svg onload="alert(1)"/>'), {
        filename: 'logo.png',
        contentType: 'image/png',
      })
      .expect(422);

    expect(response.body.error.message).toBe(
      'O logo deve ser uma imagem PNG, JPEG ou WebP',
    );
    expect(service.uploadLogo).not.toHaveBeenCalled();
  });

  it('rejects a logo above the size limit', async () => {
    await request(app.getHttpServer())
      .put('/organizations/customization/logo')
      .attach('file', Buffer.concat([PNG, Buffer.alloc(LOGO_MAX_BYTES)]), {
        filename: 'logo.png',
        contentType: 'image/png',
      })
      .expect(413);

    expect(service.uploadLogo).not.toHaveBeenCalled();
  });

  it('serves the logo as an image cached for good', async () => {
    const response = await request(app.getHttpServer())
      .get('/logos/org-1')
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];

        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);

    expect(response.headers['content-type']).toBe('image/png');
    expect(response.headers['cache-control']).toBe(
      'public, max-age=31536000, immutable',
    );
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.compare(response.body, PNG)).toBe(0);
    expect(service.findLogo).toHaveBeenCalledWith('org-1');
  });
});
