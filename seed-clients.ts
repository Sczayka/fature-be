import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import 'dotenv/config';

const connectionString = process.env.DATABASE_URL!.replace('?sslmode=require', '');
const pool = new pg.Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const organization = await prisma.organization.findFirst();

  if (!organization) {
    console.error('Nenhuma organization encontrada no banco.');
    return;
  }

  const clients = [
    { name: 'João Silva', email: 'joao.silva@exemplo.com', phone: '(11) 3333-4444', mobile: '(11) 98888-7777' },
    { name: 'Maria Oliveira', email: 'maria.oliveira@exemplo.com', phone: '(21) 3444-5555', mobile: '(21) 97777-6666' },
    { name: 'Carlos Santos', email: 'carlos.santos@exemplo.com', phone: '(31) 3555-6666', mobile: '(31) 96666-5555' },
    { name: 'Ana Costa', email: 'ana.costa@exemplo.com', phone: '(41) 3666-7777', mobile: '(41) 95555-4444' },
    { name: 'Lucas Pereira', email: 'lucas.pereira@exemplo.com', phone: '(51) 3777-8888', mobile: '(51) 94444-3333' },
    { name: 'Juliana Rodrigues', email: 'juliana.rodrigues@exemplo.com', phone: '(61) 3888-9999', mobile: '(61) 93333-2222' },
    { name: 'Marcos Almeida', email: 'marcos.almeida@exemplo.com', phone: '(71) 3999-0000', mobile: '(71) 92222-1111' },
    { name: 'Fernanda Lima', email: 'fernanda.lima@exemplo.com', phone: '(81) 3000-1111', mobile: '(81) 91111-0000' },
    { name: 'Rafael Gomes', email: 'rafael.gomes@exemplo.com', phone: '(91) 3111-2222', mobile: '(91) 90000-9999' },
    { name: 'Patrícia Martins', email: 'patricia.martins@exemplo.com', phone: '(11) 3222-3333', mobile: '(11) 99999-8888' },
    { name: 'Rodrigo Barbosa', email: 'rodrigo.barbosa@exemplo.com', phone: '(21) 3333-4444', mobile: '(21) 98888-7777' },
    { name: 'Camila Rocha', email: 'camila.rocha@exemplo.com', phone: '(31) 3444-5555', mobile: '(31) 97777-6666' },
    { name: 'Bruno Mendes', email: 'bruno.mendes@exemplo.com', phone: '(41) 3555-6666', mobile: '(41) 96666-5555' },
    { name: 'Letícia Cardoso', email: 'leticia.cardoso@exemplo.com', phone: '(51) 3666-7777', mobile: '(51) 95555-4444' },
    { name: 'Thiago Teixeira', email: 'thiago.teixeira@exemplo.com', phone: '(61) 3777-8888', mobile: '(61) 94444-3333' },
  ];

  for (const client of clients) {
    await prisma.client.create({
      data: {
        ...client,
        organizationId: organization.id,
      },
    });
  }

  console.log(`Foram criados ${clients.length} clientes para a organização ${organization.name}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
