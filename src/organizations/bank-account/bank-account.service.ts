import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PIX_MODE } from '../../payments/manual/manual-payments.constants.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  BANK_ACCOUNT_SELECT,
  BANK_ACCOUNT_SETTINGS_SELECT,
  BankAccountData,
  BankAccountSettings,
  MANUAL_PAYMENT_NOT_RELEASED,
} from './bank-account.constants.js';
import { UpdateBankAccountDto } from './dto/update-bank-account.dto.js';

interface BankAccountIssue {
  path: keyof BankAccountData;
  message: string;
}

/** O que o pagador precisa para transferir. */
const TRANSFER_REQUIRED: BankAccountIssue[] = [
  { path: 'bankCode', message: 'Informe o código do banco' },
  { path: 'branch', message: 'Informe a agência' },
  { path: 'accountNumber', message: 'Informe a conta com o dígito' },
  { path: 'accountType', message: 'Informe o tipo da conta' },
  { path: 'holderName', message: 'Informe o nome do titular' },
  { path: 'holderDocument', message: 'Informe o CPF/CNPJ do titular' },
];

/** O que o pagador precisa para pagar o PIX com a chave da empresa. */
const PIX_REQUIRED: BankAccountIssue[] = [
  { path: 'pixKeyType', message: 'Informe o tipo da chave PIX' },
  { path: 'pixKey', message: 'Informe a chave PIX' },
];

/**
 * Dados bancários que a empresa mostra no checkout para a transferência e o PIX manual. Cada
 * liberação do admin do Fature exige os campos da sua forma de pagamento.
 */
@Injectable()
export class BankAccountService {
  constructor(private readonly prisma: PrismaService) {}

  async get(organizationId: string): Promise<BankAccountSettings> {
    const settings = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: BANK_ACCOUNT_SETTINGS_SELECT,
    });

    if (!settings) {
      throw new NotFoundException('Organização não encontrada');
    }

    return settings;
  }

  /** Grava todos os campos (o vazio limpa) e devolve o mesmo formato do GET. */
  async update(
    organizationId: string,
    dto: UpdateBankAccountDto,
  ): Promise<BankAccountSettings> {
    const { bankTransferEnabled, pixMode } = await this.get(organizationId);
    const isManualPix = pixMode === PIX_MODE.MANUAL;

    if (!bankTransferEnabled && !isManualPix) {
      throw new ForbiddenException(MANUAL_PAYMENT_NOT_RELEASED);
    }

    const data: BankAccountData = {
      bankCode: dto.bankCode ?? null,
      bankName: dto.bankName ?? null,
      branch: dto.branch ?? null,
      accountNumber: dto.accountNumber ?? null,
      accountType: dto.accountType ?? null,
      holderName: dto.holderName ?? null,
      holderDocument: dto.holderDocument ?? null,
      pixKeyType: dto.pixKeyType ?? null,
      pixKey: dto.pixKey ?? null,
    };
    const issues = [
      ...(bankTransferEnabled ? TRANSFER_REQUIRED : []),
      ...(isManualPix ? PIX_REQUIRED : []),
    ].filter((issue) => !data[issue.path]);

    if (issues.length > 0) {
      throw new BadRequestException({
        message: issues[0].message,
        details: issues.map((issue) => `${issue.path}: ${issue.message}`),
      });
    }

    const bankAccount = await this.prisma.organizationBankAccount.upsert({
      where: { organizationId },
      create: { organizationId, ...data },
      update: data,
      select: BANK_ACCOUNT_SELECT,
    });

    return { bankTransferEnabled, pixMode, bankAccount };
  }
}
