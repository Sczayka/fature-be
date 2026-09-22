import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';

export interface CreateSubaccountPayload {
  name: string;
  email: string;
  cpfCnpj: string;
  companyType?: string;
  phone?: string;
  mobilePhone?: string;
  incomeValue?: number;
  address?: string;
  addressNumber?: string;
  complement?: string;
  province?: string;
  postalCode?: string;
  webhooks?: Array<{
    name: string;
    url: string;
    email: string;
    sendType: string;
    enabled: boolean;
    apiVersion: number;
    authToken: string;
    events: string[];
  }>;
}

export interface AsaasSubaccountResponse {
  id: string;
  name: string;
  email: string;
  walletId: string;
  apiKey: string;
  [key: string]: unknown;
}

export interface CustomerSaveRequestDTO {
  name: string;
  cpfCnpj: string;
  email?: string;
  phone?: string;
  mobilePhone?: string;
  address?: string;
  addressNumber?: string;
  complement?: string;
  province?: string;
  postalCode?: string;
  externalReference?: string;
  notificationDisabled?: boolean;
  additionalEmails?: string;
  municipalInscription?: string;
  stateInscription?: string;
  observations?: string;
  groupName?: string;
  company?: string;
  foreignCustomer?: boolean;
}

export interface CustomerGetResponseDTO {
  object: string;
  id: string;
  dateCreated: string;
  name: string;
  email: string;
  phone: string;
  mobilePhone: string;
  address: string;
  addressNumber: string;
  complement: string;
  province: string;
  city: number;
  cityName: string;
  state: string;
  country: string;
  postalCode: string;
  cpfCnpj: string;
  personType: string;
  deleted: boolean;
  additionalEmails: string;
  externalReference: string;
  notificationDisabled: boolean;
  observations: string;
  foreignCustomer: boolean;
}

export interface CustomerUpdateRequestDTO {
  name?: string;
  cpfCnpj?: string;
  email?: string;
  phone?: string;
  mobilePhone?: string;
  address?: string;
  addressNumber?: string;
  complement?: string;
  province?: string;
  postalCode?: string;
  externalReference?: string;
  notificationDisabled?: boolean;
  additionalEmails?: string;
  municipalInscription?: string;
  stateInscription?: string;
  observations?: string;
  groupName?: string;
  company?: string;
  foreignCustomer?: boolean;
}

export interface CustomerDeleteResponseDTO {
  deleted: boolean;
  id: string;
}

@Injectable()
export class AsaasService {
  private readonly logger = new Logger(AsaasService.name);
  private readonly apiUrl = process.env.ASAAS_API_URL || '';
  private readonly apiKey = process.env.ASAAS_API_KEY || '';
  private readonly encryptionKey = process.env.ASAAS_ENCRYPTION_KEY || 'chave-secreta-aes-32-chars-longg';

  async createSubaccount(
    payload: CreateSubaccountPayload,
  ): Promise<AsaasSubaccountResponse> {
    const response = await fetch(`${this.apiUrl}/v3/accounts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        access_token: this.apiKey,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => null);
      this.logger.error(
        `Asaas createSubaccount failed: ${response.status}`,
        error,
      );
      throw new Error(
        `Asaas API error: ${response.status} - ${JSON.stringify(error)}`,
      );
    }

    return response.json();
  }

  async createCustomer(
    subaccountApiKey: string,
    payload: CustomerSaveRequestDTO,
  ): Promise<CustomerGetResponseDTO> {
    const response = await fetch(`${this.apiUrl}/v3/customers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        access_token: subaccountApiKey,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => null);
      this.logger.error(
        `Asaas createCustomer failed: ${response.status}`,
        error,
      );
      throw new Error(
        `Asaas API error: ${response.status} - ${JSON.stringify(error)}`,
      );
    }

    return response.json();
  }

  async updateCustomer(
    subaccountApiKey: string,
    customerId: string,
    payload: CustomerUpdateRequestDTO,
  ): Promise<CustomerGetResponseDTO> {
    const response = await fetch(`${this.apiUrl}/v3/customers/${customerId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        access_token: subaccountApiKey,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => null);
      this.logger.error(
        `Asaas updateCustomer failed: ${response.status}`,
        error,
      );
      throw new Error(
        `Asaas API error: ${response.status} - ${JSON.stringify(error)}`,
      );
    }

    return response.json();
  }

  async deleteCustomer(
    subaccountApiKey: string,
    customerId: string,
  ): Promise<CustomerDeleteResponseDTO> {
    const response = await fetch(`${this.apiUrl}/v3/customers/${customerId}`, {
      method: 'DELETE',
      headers: {
        access_token: subaccountApiKey,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => null);
      this.logger.error(
        `Asaas deleteCustomer failed: ${response.status}`,
        error,
      );
      throw new Error(
        `Asaas API error: ${response.status} - ${JSON.stringify(error)}`,
      );
    }

    return response.json();
  }

  /** Criptografa a apiKey da subconta antes de salvar no banco (AES-256-GCM) */
  encryptApiKey(apiKey: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(
      'aes-256-gcm',
      Buffer.from(this.encryptionKey, 'utf-8').subarray(0, 32),
      iv,
    );
    let encrypted = cipher.update(apiKey, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  }

  /** Descriptografa a apiKey da subconta quando necessário para operar */
  decryptApiKey(encryptedApiKey: string): string {
    const [ivHex, authTagHex, encrypted] = encryptedApiKey.split(':');
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      Buffer.from(this.encryptionKey, 'utf-8').subarray(0, 32),
      Buffer.from(ivHex, 'hex'),
    );
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }
}
