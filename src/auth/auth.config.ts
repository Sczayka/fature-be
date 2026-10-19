import 'dotenv/config';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { APIError } from 'better-auth/api';
import { organization } from 'better-auth/plugins';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { getRoutingReferenceAmount } from '../payments/payments.constants.js';
import { PROVIDER_CAPABILITIES } from '../payments/providers/provider-capabilities.js';
import { setupOrganizationPayments } from '../payments/setup/organization-payment-setup.js';
import { frontendUrl } from '../common/utils/public-url.js';
import {
  invitationUrl,
  resetPasswordUrl,
  verificationUrl,
} from '../email/auth/auth-email-links.js';
import { sendAuthEmail } from '../email/auth/auth-emails.js';
import { renderEmailVerificationEmail } from '../email/templates/email-verification.template.js';
import { renderOrganizationInvitationEmail } from '../email/templates/organization-invitation.template.js';
import { renderPasswordResetEmail } from '../email/templates/password-reset.template.js';

const RESET_PASSWORD_EXPIRES_IN = 60 * 60; // 1 hora

const connectionString = process.env.DATABASE_URL!.replace(
  '?sslmode=require',
  '',
);
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
    resetPasswordTokenExpiresIn: RESET_PASSWORD_EXPIRES_IN,
    revokeSessionsOnPasswordReset: true,
    // Sem await: o tempo de resposta não pode revelar se o e-mail está cadastrado
    sendResetPassword: async ({ user, token }) => {
      sendAuthEmail(
        user.email,
        renderPasswordResetEmail({
          name: user.name,
          url: resetPasswordUrl(token),
          expiresInMinutes: RESET_PASSWORD_EXPIRES_IN / 60,
        }),
      );
    },
  },

  // A verificação não bloqueia o login: o fature-fe mostra um aviso até o e-mail ser confirmado
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    expiresIn: 60 * 60 * 24, // 24 horas
    sendVerificationEmail: async ({ user, url }) => {
      sendAuthEmail(
        user.email,
        renderEmailVerificationEmail({
          name: user.name,
          url: verificationUrl(url),
        }),
      );
    },
  },

  session: {
    expiresIn: 60 * 60 * 24, // 1 dia
    updateAge: 60 * 60 * 12, // 12 horas
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60, // 5 minutos
    },
  },

  trustedOrigins: [frontendUrl()],

  plugins: [
    organization({
      allowUserToCreateOrganization: true,
      creatorRole: 'owner',
      membershipLimit: 100,
      invitationExpiresIn: 60 * 60 * 24 * 7, // 7 dias
      // A página do convite (/convite/{id}) é do card de operadores
      sendInvitationEmail: async ({
        id,
        email,
        organization,
        invitation,
        inviter,
      }) => {
        sendAuthEmail(
          email,
          renderOrganizationInvitationEmail({
            inviterName: inviter.user.name,
            organizationName: organization.name,
            role: invitation.role,
            url: invitationUrl(id),
            expiresAt: invitation.expiresAt,
          }),
          { replyTo: inviter.user.email },
        );
      },
      organizationHooks: {
        // URL (slug) e logo têm validação e armazenamento próprios: só mudam pela aba
        // Customização (/organizations/customization)
        beforeUpdateOrganization: async ({ organization }) => {
          if (
            organization.slug !== undefined ||
            organization.logo !== undefined
          ) {
            throw new APIError('FORBIDDEN', {
              message:
                'Altere a URL e o logo pela aba Customização das configurações.',
            });
          }
        },
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
