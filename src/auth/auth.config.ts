import 'dotenv/config';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { organization } from 'better-auth/plugins';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { getRoutingReferenceAmount } from '../payments/payments.constants.js';
import { PROVIDER_CAPABILITIES } from '../payments/providers/provider-capabilities.js';
import { setupOrganizationPayments } from '../payments/setup/organization-payment-setup.js';

const connectionString = process.env.DATABASE_URL!.replace('?sslmode=require', '');
const pool = new pg.Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
});
const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({ adapter });

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:3000',
  basePath: '/api/auth',
  secret: process.env.BETTER_AUTH_SECRET!,

  database: prismaAdapter(prisma, {
    provider: 'postgresql',
  }),

  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
  },

  session: {
    expiresIn: 60 * 60 * 24, // 1 dia
    updateAge: 60 * 60 * 12, // 12 horas
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60, // 5 minutos
    },
  },

  trustedOrigins: [process.env.FRONTEND_URL || 'http://localhost:5173'],

  plugins: [
    organization({
      allowUserToCreateOrganization: true,
      creatorRole: 'owner',
      membershipLimit: 100,
      invitationExpiresIn: 60 * 60 * 24 * 7, // 7 dias
      organizationHooks: {
        // Contas nos provedores e taxas padrão de cada método (provedor de menor custo)
        afterCreateOrganization: async ({ organization }) => {
          try {
            await prisma.$transaction((tx) =>
              setupOrganizationPayments(tx, organization.id, {
                capabilities: PROVIDER_CAPABILITIES,
                referenceAmount: getRoutingReferenceAmount(),
              }),
            );
          } catch (error) {
            // Não derruba o cadastro: a configuração é refeita ao consultar ou salvar a empresa
            console.error(
              `Falha ao configurar pagamentos da organização ${organization.id}`,
              error,
            );
          }
        },
      },
    }),
  ],
});

export type Auth = typeof auth;
