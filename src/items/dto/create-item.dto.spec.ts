import { BadRequestException } from '@nestjs/common';
import { PayloadValidationPipe } from '../../common/pipes/payload-validation.pipe.js';
import { CreateItemDto } from './create-item.dto.js';
import { UpdateItemDto } from './update-item.dto.js';

/** Payload do formulário de produto do fature-fe. */
function productPayload(): Record<string, any> {
  return {
    name: ' Teclado Mecânico ',
    type: 'product',
    price: 249.9,
    stock: 12,
    description: 'ABNT2',
    brandId: 'brand-1',
    suppliers: [
      {
        supplierId: 'supplier-1',
        supplierCode: ' TEC-01 ',
        purchasePrice: 150.5,
        isMain: true,
      },
      { supplierId: 'supplier-2', supplierCode: '', purchasePrice: null },
    ],
  };
}

const validate =
  (metatype: typeof CreateItemDto | typeof UpdateItemDto) =>
  (payload: unknown) =>
    PayloadValidationPipe.transform(payload, { type: 'body', metatype });

async function messagesOf(
  metatype: typeof CreateItemDto | typeof UpdateItemDto,
  payload: unknown,
): Promise<string[]> {
  try {
    await validate(metatype)(payload);
    return [];
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    return (
      (error as BadRequestException).getResponse() as { message: string[] }
    ).message;
  }
}

describe('CreateItemDto', () => {
  it('accepts the product form payload, trimming the texts', async () => {
    const dto: CreateItemDto = await validate(CreateItemDto)(productPayload());

    expect(dto.name).toBe('Teclado Mecânico');
    expect(dto.suppliers?.[0].supplierCode).toBe('TEC-01');
    expect(dto.suppliers?.[1].supplierCode).toBeNull();
    expect(dto.suppliers?.[1].purchasePrice).toBeNull();
  });

  it('accepts the quick create of the invoice, without brand and suppliers', async () => {
    const dto: CreateItemDto = await validate(CreateItemDto)({
      name: 'Instalação',
      type: 'service',
      price: 80,
      stock: 0,
      description: '',
    });

    expect(dto.brandId).toBeUndefined();
    expect(dto.suppliers).toBeUndefined();
  });

  // O body ia direto para o Prisma: nenhuma coluna fora do contrato pode passar
  it('drops other columns, like the organization', async () => {
    const dto = await validate(CreateItemDto)({
      ...productPayload(),
      organizationId: 'org-2',
      id: 'item-9',
    });

    expect(dto).not.toHaveProperty('organizationId');
    expect(dto).not.toHaveProperty('id');
  });

  it('rejects an unknown type, a price that is not positive and a broken stock', async () => {
    const messages = await messagesOf(CreateItemDto, {
      ...productPayload(),
      type: 'kit',
      price: -10,
      stock: 1.5,
    });

    expect(messages).toEqual(
      expect.arrayContaining([
        'Tipo inválido: use product (produto) ou service (serviço)',
        'O preço deve ser maior que zero',
        'O estoque deve ser um número inteiro',
      ]),
    );
  });

  it('rejects a negative stock and a negative purchase price', async () => {
    const payload = productPayload();
    payload.stock = -1;
    payload.suppliers[0].purchasePrice = -5;

    const messages = await messagesOf(CreateItemDto, payload);

    expect(messages).toEqual(
      expect.arrayContaining([
        'O estoque não pode ser negativo',
        'suppliers.0.O preço de compra não pode ser negativo',
      ]),
    );
  });

  it('requires the supplier of each link and a list of suppliers', async () => {
    await expect(
      messagesOf(CreateItemDto, { ...productPayload(), suppliers: [{}] }),
    ).resolves.toContain('suppliers.0.Informe o fornecedor');
    await expect(
      messagesOf(CreateItemDto, { ...productPayload(), suppliers: null }),
    ).resolves.toContain('Envie os fornecedores em uma lista');
  });

  it('reads an empty brand as no brand', async () => {
    const dto: CreateItemDto = await validate(CreateItemDto)({
      ...productPayload(),
      brandId: '',
    });

    expect(dto.brandId).toBeNull();
  });
});

describe('UpdateItemDto', () => {
  it('keeps only the fields that were sent', async () => {
    const dto = await validate(UpdateItemDto)({ price: 99.9 });

    expect(dto).toEqual({ price: 99.9 });
  });

  it('accepts null to remove the brand and [] to remove the suppliers', async () => {
    const dto = await validate(UpdateItemDto)({ brandId: null, suppliers: [] });

    expect(dto).toEqual({ brandId: null, suppliers: [] });
  });

  it('rejects null in the fields the item always has', async () => {
    const messages = await messagesOf(UpdateItemDto, {
      name: null,
      price: null,
      stock: null,
    });

    expect(messages).toEqual(
      expect.arrayContaining([
        'Informe o nome',
        'O preço deve ser maior que zero',
        'O estoque deve ser um número inteiro',
      ]),
    );
  });
});
