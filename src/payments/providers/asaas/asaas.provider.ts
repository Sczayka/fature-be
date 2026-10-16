import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { daysBetween } from '../../../invoices/pricing/dates.js';
import { CredentialsCipher } from '../../credentials/credentials-cipher.js';
import {
  CardPayment,
  ChargeDetails,
  CreateChargeInput,
  CreatedGatewayAccount,
  CustomerProfile,
  GatewayAccountRef,
  OrganizationProfile,
  PaymentEvent,
  PaymentEventType,
  PaymentProvider,
  PaymentProviderError,
  ProviderCharge,
  ProviderChargeStatus,
  ProviderCustomer,
  WebhookRequest,
} from '../payment-provider.js';
import { AsaasApiError, AsaasClient } from './asaas.client.js';
import {
  ASAAS_BILLING_TYPES,
  ASAAS_CAPABILITIES,
  ASAAS_PAID_STATUSES,
  ASAAS_PROVIDER,
  ASAAS_WEBHOOK_EVENTS,
} from './asaas.constants.js';
import type {
  AsaasCustomerRequest,
  AsaasPayment,
  AsaasPaymentRequest,
  AsaasWebhookEvent,
  AsaasWebhookRequest,
} from './asaas.types.js';

const EVENT_TYPES: Record<string, PaymentEventType> = {
  PAYMENT_CONFIRMED: 'CHARGE_PAID',
  PAYMENT_RECEIVED: 'CHARGE_PAID',
  PAYMENT_OVERDUE: 'CHARGE_OVERDUE',
  PAYMENT_DELETED: 'CHARGE_CANCELLED',
  PAYMENT_REFUNDED: 'CHARGE_REFUNDED',
  PAYMENT_CREDIT_CARD_CAPTURE_REFUSED: 'CHARGE_FAILED',
  PAYMENT_REPROVED_BY_RISK_ANALYSIS: 'CHARGE_FAILED',
};

const CARD_REFUSED_MESSAGE =
  'Pagamento não autorizado. Confira os dados do cartão ou use outro cartão.';

/** Adaptador do Asaas: subcontas por organização, cobranças com valor do Fature e webhook por subconta. */
@Injectable()
export class AsaasProvider implements PaymentProvider {
  readonly code = ASAAS_PROVIDER;
  readonly capabilities = ASAAS_CAPABILITIES;

  private readonly logger = new Logger(AsaasProvider.name);

  constructor(
    private readonly client: AsaasClient,
    private readonly cipher: CredentialsCipher,
  ) {}

  async createAccount(
    organization: OrganizationProfile,
  ): Promise<CreatedGatewayAccount> {
    const subaccount = await this.call(
      () =>
        this.client.createSubaccount({
          name: organization.name,
          email: `org-${organization.id}@fature.com.br`,
          cpfCnpj: organization.cnpj,
          companyType: organization.companyType ?? undefined,
          phone: organization.phone ?? undefined,
          mobilePhone: organization.mobilePhone ?? undefined,
          incomeValue: organization.incomeValue ?? undefined,
          address: organization.address ?? undefined,
          addressNumber: organization.addressNumber ?? undefined,
          complement: organization.complement ?? undefined,
          province: organization.province ?? undefined,
          postalCode: organization.postalCode ?? undefined,
        }),
      false,
    );

    return {
      accountId: subaccount.id,
      metadata: {
        ...subaccount,
        apiKey: this.cipher.encrypt(subaccount.apiKey),
      },
    };
  }

  async onboardAccount(
    account: GatewayAccountRef,
  ): Promise<Record<string, unknown>> {
    const metadata = this.readMetadata(account);
    const apiKey = this.apiKey(account);
    const updates: Record<string, unknown> = {};

    if (!metadata.webhookId) {
      const webhook = this.webhookConfig(metadata);

      if (webhook) {
        const created = await this.call(
          () => this.client.createWebhook(apiKey, webhook),
          false,
        );
        updates.webhookId = created.id;
      } else {
        this.logger.warn(
          `Webhook não registrado para a conta ${account.id}: defina BACKEND_PUBLIC_URL e ASAAS_WEBHOOK_TOKEN`,
        );
      }
    }

    if (!metadata.pixKeyId) {
      try {
        const keys = await this.client.listPixKeys(apiKey);
        const key = keys.data[0] ?? (await this.client.createPixKey(apiKey));

        updates.pixKeyId = key.id;
      } catch (error) {
        // A chave só pode ser criada com a conta aprovada; sem ela, o QR Code vale até o fim do dia
        this.logger.warn(
          `Chave PIX não criada para a conta ${account.id}`,
          error,
        );
      }
    }

    return { ...metadata, ...updates };
  }

  async createCustomer(
    account: GatewayAccountRef,
    customer: CustomerProfile,
  ): Promise<ProviderCustomer> {
    if (!customer.cpfCnpj) {
      throw new PaymentProviderError(
        'O cliente precisa de CPF ou CNPJ cadastrado para receber cobranças',
        'INVALID_DATA',
      );
    }

    const created = await this.call(
      () =>
        this.client.createCustomer(
          this.apiKey(account),
          this.toCustomerRequest(customer),
        ),
      false,
    );

    return { externalId: created.id, metadata: created };
  }

  async updateCustomer(
    account: GatewayAccountRef,
    externalId: string,
    customer: CustomerProfile,
  ): Promise<void> {
    await this.call(
      () =>
        this.client.updateCustomer(
          this.apiKey(account),
          externalId,
          this.toCustomerRequest(customer),
        ),
      false,
    );
  }

  async deleteCustomer(
    account: GatewayAccountRef,
    externalId: string,
  ): Promise<void> {
    await this.call(
      () => this.client.deleteCustomer(this.apiKey(account), externalId),
      false,
    );
  }

  async createCharge(
    account: GatewayAccountRef,
    input: CreateChargeInput,
  ): Promise<ProviderCharge> {
    const apiKey = this.apiKey(account);
    // Montado fora do `call`: erro de configuração não vira "provedor indisponível"
    const request = this.toPaymentRequest(input);
    const payment = await this.call(
      () => this.client.createPayment(apiKey, request),
      input.method === 'CREDIT_CARD',
    );

    return {
      externalId: payment.id,
      status: this.toChargeStatus(payment.status),
      details: await this.loadDetails(apiKey, payment, input.method),
      raw: payment,
    };
  }

  async cancelCharge(
    account: GatewayAccountRef,
    externalId: string,
  ): Promise<void> {
    try {
      await this.client.deletePayment(this.apiKey(account), externalId);
    } catch (error) {
      // Já removida no Asaas
      if (error instanceof AsaasApiError && error.status === 404) return;

      throw this.toProviderError(error, false);
    }
  }

  async findChargesByReference(
    account: GatewayAccountRef,
    reference: string,
  ): Promise<ProviderCharge[]> {
    const payments = await this.call(
      () =>
        this.client.listPaymentsByReference(this.apiKey(account), reference),
      false,
    );

    return payments.data
      .filter((payment) => !payment.deleted)
      .map((payment) => ({
        externalId: payment.id,
        status: this.toChargeStatus(payment.status),
        details: this.baseDetails(payment),
        raw: payment,
      }));
  }

  parseWebhook(request: WebhookRequest): PaymentEvent[] {
    this.authenticateWebhook(request.headers['asaas-access-token']);

    const body = JSON.parse(
      request.rawBody.toString('utf8'),
    ) as AsaasWebhookEvent;
    const payment = body.payment ?? null;

    return [
      {
        externalEventId: body.id,
        type: EVENT_TYPES[body.event] ?? 'IGNORED',
        providerType: body.event,
        chargeExternalId: payment?.id ?? null,
        paidAt:
          payment?.clientPaymentDate ??
          payment?.paymentDate ??
          payment?.confirmedDate ??
          null,
        paidValue: payment?.value ?? null,
        raw: body,
      },
    ];
  }

  private toPaymentRequest(input: CreateChargeInput): AsaasPaymentRequest {
    const base: AsaasPaymentRequest = {
      customer: input.customerExternalId,
      billingType: ASAAS_BILLING_TYPES[input.method] ?? input.method,
      value: input.value,
      dueDate: input.dueDate,
      description: input.description,
      externalReference: input.reference,
      ...this.splitFor(input.splitAmount),
    };

    switch (input.method) {
      case 'BANK_SLIP':
        return {
          ...base,
          // Multa e juros sempre enviados para não herdar a configuração padrão da subconta
          fine: { type: 'FIXED', value: input.fine },
          interest: { value: input.interestPercent },
          ...(input.discount
            ? {
                discount: {
                  type: 'FIXED',
                  value: input.discount.value,
                  dueDateLimitDays: daysBetween(
                    input.discount.until,
                    input.dueDate,
                  ),
                },
              }
            : {}),
        };

      case 'PIX':
        // O valor já é o do dia, calculado pelo Fature
        return {
          ...base,
          fine: { type: 'FIXED', value: 0 },
          interest: { value: 0 },
        };

      case 'CREDIT_CARD':
        return {
          ...base,
          ...this.cardFields(input.payment),
          remoteIp: input.payerIp,
        };
    }
  }

  private cardFields(payment: CardPayment): Partial<AsaasPaymentRequest> {
    if (payment.mode !== 'RAW') {
      throw new PaymentProviderError(
        'Captura de cartão não suportada pelo provedor',
        'INVALID_DATA',
      );
    }

    const { card, holder } = payment;

    return {
      creditCard: {
        holderName: card.holderName,
        number: card.number,
        expiryMonth: card.expiryMonth,
        expiryYear: card.expiryYear,
        ccv: card.ccv,
      },
      creditCardHolderInfo: {
        name: holder.name,
        email: holder.email,
        cpfCnpj: holder.cpfCnpj,
        postalCode: holder.postalCode,
        addressNumber: holder.addressNumber,
        phone: holder.phone,
        mobilePhone: holder.phone,
      },
    };
  }

  private splitFor(splitAmount: number): Partial<AsaasPaymentRequest> {
    if (splitAmount <= 0) return {};

    const walletId = process.env.ASAAS_PLATFORM_WALLET_ID;

    if (!walletId) {
      throw new Error(
        'ASAAS_PLATFORM_WALLET_ID não configurada: a margem do Fature não pode ser enviada',
      );
    }

    return { split: [{ walletId, fixedValue: splitAmount }] };
  }

  private async loadDetails(
    apiKey: string,
    payment: AsaasPayment,
    method: CreateChargeInput['method'],
  ): Promise<ChargeDetails> {
    const details = this.baseDetails(payment);

    if (method === 'PIX') {
      try {
        const qrCode = await this.client.getPixQrCode(apiKey, payment.id);

        return {
          ...details,
          pixPayload: qrCode.payload,
          pixQrCodeImage: qrCode.encodedImage,
          pixExpiresAt: qrCode.expirationDate,
        };
      } catch (error) {
        // Sem QR Code a cobrança não serve ao pagador
        await this.client.deletePayment(apiKey, payment.id).catch(() => null);
        throw this.toProviderError(error, false);
      }
    }

    if (method === 'BANK_SLIP') {
      try {
        const field = await this.client.getIdentificationField(
          apiKey,
          payment.id,
        );

        return { ...details, identificationField: field.identificationField };
      } catch (error) {
        this.logger.warn(
          `Linha digitável indisponível para o boleto ${payment.id}`,
          error,
        );
      }
    }

    return details;
  }

  private baseDetails(payment: AsaasPayment): ChargeDetails {
    return {
      invoiceUrl: payment.invoiceUrl ?? null,
      bankSlipUrl: payment.bankSlipUrl ?? null,
      identificationField: null,
      pixPayload: null,
      pixQrCodeImage: null,
      pixExpiresAt: null,
      receiptUrl: payment.transactionReceiptUrl ?? null,
    };
  }

  private toChargeStatus(status: string): ProviderChargeStatus {
    if (ASAAS_PAID_STATUSES.includes(status)) return 'PAID';
    if (status === 'AWAITING_RISK_ANALYSIS') return 'IN_ANALYSIS';

    return 'PENDING';
  }

  private toCustomerRequest(customer: CustomerProfile): AsaasCustomerRequest {
    return {
      name: customer.name,
      cpfCnpj: customer.cpfCnpj ?? undefined,
      email: customer.email || undefined,
      phone: customer.phone || undefined,
      mobilePhone: customer.mobile || undefined,
      address: customer.addressLine || undefined,
      addressNumber: customer.addressNumber || undefined,
      complement: customer.complement || undefined,
      province: customer.district || undefined,
      postalCode: customer.cep || undefined,
      municipalInscription: customer.municipalInscription || undefined,
      stateInscription: customer.stateInscription || undefined,
      notificationDisabled: true,
    };
  }

  private webhookConfig(
    metadata: Record<string, unknown>,
  ): AsaasWebhookRequest | null {
    const baseUrl = process.env.BACKEND_PUBLIC_URL;
    const authToken = process.env.ASAAS_WEBHOOK_TOKEN;

    if (!baseUrl || !authToken) return null;

    return {
      name: 'Fature',
      url: `${baseUrl.replace(/\/$/, '')}/webhooks/${this.code.toLowerCase()}`,
      email: typeof metadata.email === 'string' ? metadata.email : undefined,
      enabled: true,
      interrupted: false,
      apiVersion: 3,
      authToken,
      sendType: 'SEQUENTIALLY',
      events: ASAAS_WEBHOOK_EVENTS,
    };
  }

  private authenticateWebhook(header: string | string[] | undefined) {
    const expected = process.env.ASAAS_WEBHOOK_TOKEN;
    const received = Array.isArray(header) ? header[0] : header;

    if (!expected) {
      this.logger.error(
        'ASAAS_WEBHOOK_TOKEN não configurada: webhook recusado',
      );
    }

    const isValid =
      !!expected &&
      !!received &&
      received.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected));

    if (!isValid) {
      throw new PaymentProviderError('Webhook não autenticado', 'UNAUTHORIZED');
    }
  }

  private apiKey(account: GatewayAccountRef): string {
    const encrypted = this.readMetadata(account).apiKey;

    if (typeof encrypted !== 'string' || !encrypted) {
      throw new PaymentProviderError(
        'Conta do provedor sem credenciais',
        'UNAVAILABLE',
      );
    }

    return this.cipher.decrypt(encrypted);
  }

  private readMetadata(account: GatewayAccountRef): Record<string, unknown> {
    return (account.metadata ?? {}) as Record<string, unknown>;
  }

  private async call<T>(
    request: () => Promise<T>,
    isCard: boolean,
  ): Promise<T> {
    try {
      return await request();
    } catch (error) {
      throw this.toProviderError(error, isCard);
    }
  }

  private toProviderError(error: unknown, isCard: boolean): Error {
    if (error instanceof PaymentProviderError) return error;

    if (error instanceof AsaasApiError && error.status === 400) {
      // O motivo da recusa do cartão não é repassado ao pagador
      return isCard
        ? new PaymentProviderError(CARD_REFUSED_MESSAGE, 'CARD_REFUSED')
        : new PaymentProviderError(
            error.description ?? 'Dados recusados pelo provedor de pagamento',
            'INVALID_DATA',
          );
    }

    // Erros HTTP já foram logados pelo cliente; aqui ficam rede e timeout
    if (!(error instanceof AsaasApiError)) {
      this.logger.error('Falha de comunicação com o Asaas', error);
    }

    return new PaymentProviderError(
      'Provedor de pagamento indisponível. Tente novamente em instantes.',
      'UNAVAILABLE',
    );
  }
}
