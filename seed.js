import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { randomUUID } from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

const connectionString = process.env.DATABASE_URL.replace('?sslmode=require', '');
const pool = new pg.Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("Iniciando a criação de massas...");

  // Try to find any organization
  let org = await prisma.organization.findFirst();

  if (!org) {
    console.log("Nenhuma organização encontrada. Criando uma padrão...");
    const user = await prisma.user.create({
      data: {
        id: randomUUID(),
        name: "Test User",
        email: "test@example.com",
        emailVerified: true,
      }
    });

    org = await prisma.organization.create({
      data: {
        id: randomUUID(),
        name: "Default Organization",
        slug: "default-org",
      }
    });
    
    await prisma.member.create({
      data: {
        id: randomUUID(),
        organizationId: org.id,
        userId: user.id,
        role: "admin"
      }
    });
  }

  console.log(`Usando organização: ${org.name} (${org.id})`);

  console.log("Criando 150 itens mockados...");
  
  const items = [];
  for (let i = 1; i <= 150; i++) {
    const isProduct = Math.random() > 0.5;
    items.push({
      id: randomUUID(),
      name: `${isProduct ? 'Produto' : 'Serviço'} de Teste ${i}`,
      price: Math.round(Math.random() * 10000) / 100,
      type: isProduct ? 'produto' : 'servico',
      stock: isProduct ? Math.floor(Math.random() * 100) : 0,
      description: `Descrição gerada automaticamente para o item de teste número ${i}`,
      organizationId: org.id,
    });
  }

  await prisma.item.createMany({
    data: items,
  });

  console.log("150 itens criados com sucesso!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
