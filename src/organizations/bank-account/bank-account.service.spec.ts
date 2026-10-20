import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { BankAccountService } from './bank-account.service.js';
import { BANK_ACCOUNT_SELECT } from './bank-account.constants.js';

// PrismaService abre o pool do banco ao ser importado; os testes usam mocks
vi.mock('../../prisma/prisma.service.js', () => ({ PrismaService: class {} }));

const transferData = {
  bankCode: '341',
  bankName: 'Itaú',
  branch: '0001',
  accountNumber: '12345-6',
  accountType: 'CHECKING' as const,
  holderName: 'Raipp Ltda',
  holderDocument: '11222333000181',
};

const pixData = {
  pixKeyType: 'CNPJ' as const,
  pixKey: '11222333000181',
};

describe('BankAccountService', () => {
  let prisma: any;
  let service: BankAccountService;

  const release = (settings: Record<string, unknown>) =>
    prisma.organization.findUnique.mockResolvedValue({
      bankTransferEnabled: false,
      pixMode: 'AUTOMATIC',
      bankAccount: null,
      ...settings,
    });

  async function detailsOf(promise: Promise<unknown>): Promise<string[]> {
    const error = await promise.catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(BadRequestException);

    return (
      (error as BadRequestException).getResponse() as { details: string[] }
    ).details;
  }

  beforeEach(() => {
    prisma = {
      organization: {
        findUnique: vi.fn().mockResolvedValue({
          bankTransferEnabled: true,
          pixMode: 'AUTOMATIC',
          bankAccount: null,
        }),
      },
      organizationBankAccount: {
        upsert: vi
          .fn()
          .mockImplementation(({ update }) => Promise.resolve(update)),
      },
    };
    service = new BankAccountService(prisma);
  });

  describe('get', () => {
    it('returns the releases and no account before the first save', async () => {
      await expect(service.get('org-1')).resolves.toEqual({
        bankTransferEnabled: true,
        pixMode: 'AUTOMATIC',
        bankAccount: null,
      });
      expect(prisma.organization.findUnique).toHaveBeenCalledWith({
        where: { id: 'org-1' },
        select: {
          bankTransferEnabled: true,
          pixMode: true,
          bankAccount: { select: BANK_ACCOUNT_SELECT },
        },
      });
    });

    it('fails when the organization does not exist', async () => {
      prisma.organization.findUnique.mockResolvedValue(null);

      await expect(service.get('org-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('refuses an organization without any manual payment released', async () => {
      release({});

      const error = await service
        .update('org-1', { ...transferData, ...pixData })
        .catch((reason: unknown) => reason);

      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as Error).message).toBe(
        'Pagamento manual não liberado para esta empresa.',
      );
      expect(prisma.organizationBankAccount.upsert).not.toHaveBeenCalled();
    });

    it('requires the transfer data when the bank transfer is released', async () => {
      release({ bankTransferEnabled: true });

      await expect(
        detailsOf(service.update('org-1', pixData)),
      ).resolves.toEqual([
        'bankCode: Informe o código do banco',
        'branch: Informe a agência',
        'accountNumber: Informe a conta com o dígito',
        'accountType: Informe o tipo da conta',
        'holderName: Informe o nome do titular',
        'holderDocument: Informe o CPF/CNPJ do titular',
      ]);
      expect(prisma.organizationBankAccount.upsert).not.toHaveBeenCalled();
    });

    it('requires the PIX key in the manual PIX mode', async () => {
      release({ pixMode: 'MANUAL' });

      await expect(
        detailsOf(service.update('org-1', transferData)),
      ).resolves.toEqual([
        'pixKeyType: Informe o tipo da chave PIX',
        'pixKey: Informe a chave PIX',
      ]);
    });

    it('requires the fields of both releases', async () => {
      release({ bankTransferEnabled: true, pixMode: 'MANUAL' });

      const details = await detailsOf(
        service.update('org-1', { ...transferData, holderName: null }),
      );

      expect(details).toEqual([
        'holderName: Informe o nome do titular',
        'pixKeyType: Informe o tipo da chave PIX',
        'pixKey: Informe a chave PIX',
      ]);
    });

    it('does not require the transfer data when only the manual PIX is released', async () => {
      release({ pixMode: 'MANUAL' });

      await expect(service.update('org-1', pixData)).resolves.toMatchObject({
        bankTransferEnabled: false,
        pixMode: 'MANUAL',
        bankAccount: { pixKeyType: 'CNPJ', bankCode: null },
      });
    });

    it('saves every field, clearing the missing ones, and returns the settings', async () => {
      release({ bankTransferEnabled: true });

      const saved = await service.update('org-1', transferData);
      const data = { ...transferData, pixKeyType: null, pixKey: null };

      expect(prisma.organizationBankAccount.upsert).toHaveBeenCalledWith({
        where: { organizationId: 'org-1' },
        create: { organizationId: 'org-1', ...data },
        update: data,
        select: BANK_ACCOUNT_SELECT,
      });
      expect(saved).toEqual({
        bankTransferEnabled: true,
        pixMode: 'AUTOMATIC',
        bankAccount: data,
      });
    });
  });
});
