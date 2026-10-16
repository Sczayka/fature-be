import { readFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Taxas negociadas entre o Fature e os provedores (PlatformPaymentMethod). O JSON ao lado é
 * a fonte: para cadastrar um provedor, adicione as linhas dele e rode de novo (upsert por
 * provider + method). Linhas de provedores sem adaptador são ignoradas na escolha do padrão.
 * Valem para organizações novas; as existentes mantêm o padrão do registro.
 */
const connectionString = process.env.DATABASE_URL.replace(
  '?sslmode=require',
  '',
);
const pool = new pg.Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
});
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  const rates = JSON.parse(
    await readFile(
      new URL('./platform-payment-methods.json', import.meta.url),
      'utf8',
    ),
  );

  for (const rate of rates) {
    await prisma.platformPaymentMethod.upsert({
      where: {
        provider_method: { provider: rate.provider, method: rate.method },
      },
      create: rate,
      update: rate,
    });

    console.log(
      `${rate.provider} ${rate.method}: custo R$ ${rate.costFixed} + ${rate.costPercent}% (${rate.active ? 'ativo' : 'inativo'})`,
    );
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
