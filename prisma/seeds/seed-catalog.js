import { readFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Carga de demonstração do catálogo de uma organização (catalog.json ao lado): marcas,
 * fornecedores com contatos e contas, produtos e serviços com a marca e os fornecedores. Pode
 * rodar de novo: o que tem o mesmo nome é atualizado, sem duplicar. Os contatos e as contas de um
 * fornecedor que já existia não mudam.
 *
 * npm run catalog:seed -- --org=<organizationId>
 */
const organizationId = process.argv
  .find((arg) => arg.startsWith('--org='))
  ?.slice('--org='.length);

if (!organizationId) {
  console.error(
    'Informe a organização: npm run catalog:seed -- --org=<organizationId>',
  );
  process.exit(1);
}

const connectionString = process.env.DATABASE_URL.replace(
  '?sslmode=require',
  '',
);
const pool = new pg.Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
});
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function seedBrands(tx, brands) {
  const brandIds = new Map();

  for (const brand of brands) {
    const { id } = await tx.brand.upsert({
      where: { organizationId_name: { organizationId, name: brand.name } },
      create: { ...brand, organizationId },
      update: { active: brand.active },
      select: { id: true },
    });

    brandIds.set(brand.name, id);
  }

  return brandIds;
}

async function seedSuppliers(tx, suppliers, brandIds) {
  const supplierIds = new Map();

  for (const {
    key,
    brands,
    contacts,
    bankAccounts,
    ...supplier
  } of suppliers) {
    const existing = await tx.supplier.findUnique({
      where: { organizationId_name: { organizationId, name: supplier.name } },
      select: { id: true },
    });

    const { id } = existing
      ? await tx.supplier.update({
          where: { id: existing.id },
          data: supplier,
          select: { id: true },
        })
      : await tx.supplier.create({
          data: {
            ...supplier,
            organizationId,
            contacts: { create: contacts },
            bankAccounts: { create: bankAccounts },
          },
          select: { id: true },
        });

    await tx.supplierBrand.createMany({
      data: brands.map((name) => ({
        supplierId: id,
        brandId: brandIds.get(name),
      })),
      skipDuplicates: true,
    });

    supplierIds.set(key, id);
  }

  return supplierIds;
}

async function seedItems(tx, items, brandIds, supplierIds) {
  for (const { brand, suppliers, ...item } of items) {
    const data = { ...item, brandId: brand ? brandIds.get(brand) : null };
    const links = suppliers.map(({ supplier, ...link }) => ({
      ...link,
      supplierId: supplierIds.get(supplier),
    }));

    const existing = await tx.item.findFirst({
      where: { organizationId, name: item.name, type: item.type },
      select: { id: true },
    });

    if (existing) {
      // Os fornecedores do item são gravados por substituição, como no ItemsService
      await tx.itemSupplier.deleteMany({ where: { itemId: existing.id } });
      await tx.item.update({
        where: { id: existing.id },
        data: { ...data, suppliers: { create: links } },
      });
    } else {
      await tx.item.create({
        data: { ...data, organizationId, suppliers: { create: links } },
      });
    }
  }
}

async function main() {
  const catalog = JSON.parse(
    await readFile(new URL('./catalog.json', import.meta.url), 'utf8'),
  );

  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { name: true },
  });

  if (!organization) {
    throw new Error(`Organização ${organizationId} não encontrada`);
  }

  // Tudo ou nada; o banco remoto precisa de mais que os 5 s padrão da transação
  await prisma.$transaction(
    async (tx) => {
      const brandIds = await seedBrands(tx, catalog.brands);
      const supplierIds = await seedSuppliers(tx, catalog.suppliers, brandIds);

      await seedItems(tx, catalog.items, brandIds, supplierIds);
    },
    { maxWait: 10_000, timeout: 120_000 },
  );

  const products = catalog.items.filter((item) => item.type === 'product');

  console.log(`Organização: ${organization.name} (${organizationId})`);
  console.log(`${catalog.brands.length} marcas`);
  console.log(`${catalog.suppliers.length} fornecedores`);
  console.log(`${products.length} produtos`);
  console.log(`${catalog.items.length - products.length} serviços`);
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
