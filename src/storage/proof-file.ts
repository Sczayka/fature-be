import { HttpStatus, ParseFilePipeBuilder } from '@nestjs/common';
import { createHash } from 'crypto';

/** Limite de cada comprovante. */
export const PROOF_MAX_BYTES = 5 * 1024 * 1024;
/** Conferido pelos bytes do arquivo, não pelo tipo informado pelo navegador. */
export const PROOF_MIME_TYPES = /^(image\/(png|jpeg|webp)|application\/pdf)$/;
/** Validade da URL assinada que abre o comprovante. */
export const STORAGE_SIGNED_URL_TTL_SECONDS = 300;

const PROOF_NAME_MAX_LENGTH = 200;

const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

export const proofFilePipe = new ParseFilePipeBuilder()
  .addFileTypeValidator({
    fileType: PROOF_MIME_TYPES,
    errorMessage:
      'O comprovante deve ser uma imagem (JPEG, PNG ou WebP) ou um PDF',
  })
  .addMaxSizeValidator({
    maxSize: PROOF_MAX_BYTES,
    message: 'O comprovante deve ter no máximo 5 MB',
  })
  .build({ errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY });

/** Arquivo recebido pelo multer (FileInterceptor), já validado pelo `proofFilePipe`. */
export interface UploadedProof {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

export interface ProofFields {
  proofKey: string;
  proofMimeType: string;
  proofSize: number;
  proofName: string;
  proofSha256: string;
}

/** Chave do comprovante no bucket. O nome original nunca vai na chave. */
export function proofObjectKey(
  organizationId: string,
  invoiceId: string,
  transactionId: string,
  mimeType: string,
): string {
  const extension = EXTENSION_BY_MIME_TYPE[mimeType] ?? 'bin';

  return `organizations/${organizationId}/invoices/${invoiceId}/${transactionId}.${extension}`;
}

/** Campos do comprovante gravados na transação. */
export function proofFields(file: UploadedProof, key: string): ProofFields {
  return {
    proofKey: key,
    proofMimeType: file.mimetype,
    proofSize: file.size,
    proofName: baseName(file.originalname).slice(0, PROOF_NAME_MAX_LENGTH),
    proofSha256: createHash('sha256').update(file.buffer).digest('hex'),
  };
}

/** Nome sem o caminho (alguns navegadores mandam "C:\fakepath\arquivo.pdf"). */
function baseName(fileName: string): string {
  return fileName.split(/[\\/]/).pop()?.trim() || 'comprovante';
}
