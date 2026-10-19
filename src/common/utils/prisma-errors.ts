import { Prisma } from '@prisma/client';

/**
 * Violação de unicidade (P2002): outra requisição gravou o mesmo valor entre a conferência do
 * service e a escrita. Rede de segurança para devolver 409 em vez de 500.
 */
export function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}
