import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CustomizationService } from './customization.service.js';
import type { UpdateCustomizationDto } from './dto/update-customization.dto.js';

// PrismaService abre o pool do banco ao ser importado; os testes usam mocks
vi.mock('../../prisma/prisma.service.js', () => ({ PrismaService: class {} }));

const LOGO_UPDATED_AT = new Date('2026-10-17T12:00:00Z');

const dto: UpdateCustomizationDto = {
  slug: 'raipp-studio',
  wallpaper: 'WAVES',
  backgroundColor: '#9db4dc',
  buttonColor: '#5b3fd1',
};

describe('CustomizationService', () => {
  let prisma: any;
  let tx: any;
  let service: CustomizationService;

  beforeEach(() => {
    vi.stubEnv('BACKEND_PUBLIC_URL', 'https://api.fature.com.br/');

    tx = {
      organizationLogo: {
        upsert: vi.fn().mockResolvedValue({ updatedAt: LOGO_UPDATED_AT }),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      organization: {
        update: vi
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({ logo: data.logo }),
          ),
      },
    };
    prisma = {
      organization: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({ name: 'Raipp', logo: null, ...data }),
          ),
      },
      organizationLogo: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn().mockImplementation((callback) => callback(tx)),
    };

    service = new CustomizationService(prisma);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('saves the theme and the URL without starting the payment onboarding', async () => {
    await expect(service.update('org-1', dto)).resolves.toMatchObject(dto);

    expect(prisma.organization.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'org-1' }, data: dto }),
    );
  });

  it('rejects a URL already used by another organization', async () => {
    prisma.organization.findFirst.mockResolvedValue({ id: 'org-2' });

    await expect(service.update('org-1', dto)).rejects.toThrow(
      ConflictException,
    );
    expect(prisma.organization.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { slug: 'raipp-studio', NOT: { id: 'org-1' } },
      }),
    );
    expect(prisma.organization.update).not.toHaveBeenCalled();
  });

  it('reports a conflict when the URL is taken between the check and the update', async () => {
    prisma.organization.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '7.10.0',
      }),
    );

    await expect(service.update('org-1', dto)).rejects.toThrow(
      ConflictException,
    );
  });

  it('stores the logo and points the organization to a versioned public URL', async () => {
    const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

    await expect(
      service.uploadLogo('org-1', { buffer, mimetype: 'image/png' }),
    ).resolves.toEqual({
      logo: `https://api.fature.com.br/logos/org-1?v=${LOGO_UPDATED_AT.getTime()}`,
    });
    expect(tx.organizationLogo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: 'org-1' },
        create: {
          organizationId: 'org-1',
          data: new Uint8Array(buffer),
          mimeType: 'image/png',
        },
      }),
    );
  });

  it('removes the image and clears the logo URL', async () => {
    await expect(service.removeLogo('org-1')).resolves.toEqual({ logo: null });

    expect(tx.organizationLogo.deleteMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-1' },
    });
  });

  it('answers 404 for an organization without logo', async () => {
    await expect(service.findLogo('org-1')).rejects.toThrow(NotFoundException);
  });
});
