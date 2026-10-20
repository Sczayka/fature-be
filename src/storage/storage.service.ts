import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { STORAGE_SIGNED_URL_TTL_SECONDS } from './proof-file.js';

interface StorageConfig {
  client: S3Client;
  bucket: string;
}

/**
 * Arquivos privados (comprovantes) no Cloudflare R2, pela API compatível com S3. Sem as variáveis
 * R2_*, o app sobe e só as rotas que usam arquivos respondem 503.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly config: StorageConfig | null;

  constructor() {
    const accountId = process.env.R2_ACCOUNT_ID?.trim();
    const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
    const bucket = process.env.R2_BUCKET?.trim();

    if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
      this.logger.warn(
        'Variáveis R2_* não definidas: o envio de comprovantes fica indisponível.',
      );
      this.config = null;
      return;
    }

    this.config = {
      bucket,
      client: new S3Client({
        region: 'auto',
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId, secretAccessKey },
        // O R2 não aceita os checksums que as versões recentes do SDK mandam por padrão
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
      }),
    };
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    const { client, bucket } = this.requireConfig();

    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  /** URL temporária para abrir o arquivo no navegador (expira em poucos minutos). */
  getSignedUrl(
    key: string,
    { contentType, fileName }: { contentType: string; fileName: string },
  ): Promise<string> {
    const { client, bucket } = this.requireConfig();

    return getSignedUrl(
      client,
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        ResponseContentType: contentType,
        ResponseContentDisposition: `inline; filename="${asciiFileName(fileName)}"`,
      }),
      { expiresIn: STORAGE_SIGNED_URL_TTL_SECONDS },
    );
  }

  async delete(key: string): Promise<void> {
    const { client, bucket } = this.requireConfig();

    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }

  private requireConfig(): StorageConfig {
    if (!this.config) {
      throw new ServiceUnavailableException(
        'Armazenamento de arquivos não configurado',
      );
    }

    return this.config;
  }
}

/** Nome para o cabeçalho Content-Disposition: sem acentos, aspas ou caracteres fora do ASCII. */
function asciiFileName(fileName: string): string {
  return (
    fileName
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\x20-\x7e]|["\\]/g, '_')
      .trim() || 'comprovante'
  );
}
