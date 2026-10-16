import { Injectable, Logger } from '@nestjs/common';
import { ASAAS_REQUEST_TIMEOUT_MS } from './asaas.constants.js';
import type {
  AsaasCustomer,
  AsaasCustomerRequest,
  AsaasIdentificationField,
  AsaasList,
  AsaasPayment,
  AsaasPaymentRequest,
  AsaasPixKey,
  AsaasPixQrCode,
  AsaasSubaccount,
  AsaasSubaccountRequest,
  AsaasWebhook,
  AsaasWebhookRequest,
} from './asaas.types.js';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

/** Resposta de erro da API do Asaas: `{ errors: [{ code, description }] }`. */
export class AsaasApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`Asaas API error: ${status}`);
    this.name = 'AsaasApiError';
  }

  /** Primeira descrição de erro devolvida pelo Asaas. */
  get description(): string | null {
    const errors = (this.body as { errors?: Array<{ description?: string }> })
      ?.errors;

    return errors?.[0]?.description ?? null;
  }
}

/** Cliente HTTP da API v3 do Asaas. Subcontas usam a apiKey delas; a conta raiz usa ASAAS_API_KEY. */
@Injectable()
export class AsaasClient {
  private readonly logger = new Logger(AsaasClient.name);
  private readonly apiUrl = process.env.ASAAS_API_URL || '';
  private readonly rootApiKey = process.env.ASAAS_API_KEY || '';

  createSubaccount(payload: AsaasSubaccountRequest): Promise<AsaasSubaccount> {
    return this.request(this.rootApiKey, 'POST', '/v3/accounts', payload);
  }

  createCustomer(
    apiKey: string,
    payload: AsaasCustomerRequest,
  ): Promise<AsaasCustomer> {
    return this.request(apiKey, 'POST', '/v3/customers', payload);
  }

  updateCustomer(
    apiKey: string,
    customerId: string,
    payload: AsaasCustomerRequest,
  ): Promise<AsaasCustomer> {
    return this.request(apiKey, 'PUT', `/v3/customers/${customerId}`, payload);
  }

  deleteCustomer(apiKey: string, customerId: string): Promise<unknown> {
    return this.request(apiKey, 'DELETE', `/v3/customers/${customerId}`);
  }

  createPayment(
    apiKey: string,
    payload: AsaasPaymentRequest,
  ): Promise<AsaasPayment> {
    return this.request(apiKey, 'POST', '/v3/payments', payload);
  }

  deletePayment(apiKey: string, paymentId: string): Promise<unknown> {
    return this.request(apiKey, 'DELETE', `/v3/payments/${paymentId}`);
  }

  listPaymentsByReference(
    apiKey: string,
    externalReference: string,
  ): Promise<AsaasList<AsaasPayment>> {
    const query = new URLSearchParams({ externalReference });

    return this.request(apiKey, 'GET', `/v3/payments?${query.toString()}`);
  }

  getPixQrCode(apiKey: string, paymentId: string): Promise<AsaasPixQrCode> {
    return this.request(apiKey, 'GET', `/v3/payments/${paymentId}/pixQrCode`);
  }

  getIdentificationField(
    apiKey: string,
    paymentId: string,
  ): Promise<AsaasIdentificationField> {
    return this.request(
      apiKey,
      'GET',
      `/v3/payments/${paymentId}/identificationField`,
    );
  }

  createWebhook(
    apiKey: string,
    payload: AsaasWebhookRequest,
  ): Promise<AsaasWebhook> {
    return this.request(apiKey, 'POST', '/v3/webhooks', payload);
  }

  listPixKeys(apiKey: string): Promise<AsaasList<AsaasPixKey>> {
    return this.request(apiKey, 'GET', '/v3/pix/addressKeys?status=ACTIVE');
  }

  createPixKey(apiKey: string): Promise<AsaasPixKey> {
    // A API só cria chaves aleatórias (EVP)
    return this.request(apiKey, 'POST', '/v3/pix/addressKeys', { type: 'EVP' });
  }

  private async request<T>(
    apiKey: string,
    method: HttpMethod,
    path: string,
    body?: object,
  ): Promise<T> {
    const response = await fetch(`${this.apiUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', access_token: apiKey },
      // GET com body recebe 403 do Asaas
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(ASAAS_REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => null);

      // Só a resposta é logada: o corpo enviado pode conter dados de cartão
      this.logger.error(
        `Asaas ${method} ${path.split('?')[0]} failed: ${response.status}`,
        error,
      );

      throw new AsaasApiError(response.status, error);
    }

    return (await response.json()) as T;
  }
}
