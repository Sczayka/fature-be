import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { backendPublicUrl } from '../../common/utils/public-url.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CUSTOMIZATION_SELECT } from './customization.constants.js';
import { UpdateCustomizationDto } from './dto/update-customization.dto.js';

const SLUG_TAKEN_MESSAGE = 'Esta URL já está em uso por outra empresa.';

/** Arquivo do logo recebido pelo upload (multer), já validado pelo controller. */
export interface UploadedLogo {
  buffer: Buffer;
  mimetype: string;
}

/**
 * Personalização das páginas enviadas aos clientes (checkout e, depois, e-mails): logo, papel de
 * parede, cores e a URL (slug) da organização.
 */
@Injectable()
export class CustomizationService {
  constructor(private readonly prisma: PrismaService) {}

  async get(organizationId: string) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: CUSTOMIZATION_SELECT,
    });

    if (!organization) {
      throw new NotFoundException('Organização não encontrada');
    }

    return organization;
  }

  async update(organizationId: string, dto: UpdateCustomizationDto) {
    const slugOwner = await this.prisma.organization.findFirst({
      where: { slug: dto.slug, NOT: { id: organizationId } },
      select: { id: true },
    });

    if (slugOwner) {
      throw new ConflictException(SLUG_TAKEN_MESSAGE);
    }

    try {
      return await this.prisma.organization.update({
        where: { id: organizationId },
        data: {
          slug: dto.slug,
          wallpaper: dto.wallpaper,
          backgroundColor: dto.backgroundColor,
          buttonColor: dto.buttonColor,
        },
        select: CUSTOMIZATION_SELECT,
      });
    } catch (error) {
      // Outra organização gravou o mesmo slug entre a checagem e o update
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(SLUG_TAKEN_MESSAGE);
      }

      throw error;
    }
  }

  /** Grava a imagem e troca a URL do logo; a versão na URL invalida o cache dos navegadores. */
  uploadLogo(organizationId: string, file: UploadedLogo) {
    // Bytes do Prisma é Uint8Array<ArrayBuffer>; o Buffer do multer pode estar num buffer compartilhado
    const data = new Uint8Array(file.buffer);
    const mimeType = file.mimetype;

    return this.prisma.$transaction(async (tx) => {
      const image = await tx.organizationLogo.upsert({
        where: { organizationId },
        create: { organizationId, data, mimeType },
        update: { data, mimeType },
        select: { updatedAt: true },
      });

      return tx.organization.update({
        where: { id: organizationId },
        data: { logo: this.logoUrl(organizationId, image.updatedAt) },
        select: { logo: true },
      });
    });
  }

  removeLogo(organizationId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.organizationLogo.deleteMany({ where: { organizationId } });

      return tx.organization.update({
        where: { id: organizationId },
        data: { logo: null },
        select: { logo: true },
      });
    });
  }

  async findLogo(organizationId: string) {
    const image = await this.prisma.organizationLogo.findUnique({
      where: { organizationId },
      select: { data: true, mimeType: true },
    });

    if (!image) {
      throw new NotFoundException('Logo não encontrado');
    }

    return image;
  }

  private logoUrl(organizationId: string, version: Date): string {
    return `${backendPublicUrl()}/logos/${encodeURIComponent(organizationId)}?v=${version.getTime()}`;
  }
}
