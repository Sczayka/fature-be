import { BadRequestException } from '@nestjs/common';
import { PayloadValidationPipe } from '../../common/pipes/payload-validation.pipe.js';
import { CreateStockMovementDto } from './create-stock-movement.dto.js';

const validate = (payload: unknown): Promise<CreateStockMovementDto> =>
  PayloadValidationPipe.transform(payload, {
    type: 'body',
    metatype: CreateStockMovementDto,
  });

async function messagesOf(payload: unknown): Promise<string[]> {
  try {
    await validate(payload);
    return [];
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    return (
      (error as BadRequestException).getResponse() as { message: string[] }
    ).message;
  }
}

describe('CreateStockMovementDto', () => {
  it('accepts an entry with an optional note, trimming it', async () => {
    await expect(
      validate({ type: 'ENTRY', quantity: 5, notes: ' NF 123 ' }),
    ).resolves.toMatchObject({ type: 'ENTRY', quantity: 5, notes: 'NF 123' });
    await expect(
      validate({ type: 'RETURN', quantity: 1, notes: '' }),
    ).resolves.toMatchObject({ notes: null });
  });

  it('accepts an adjustment to the counted stock, zero included', async () => {
    await expect(
      validate({ type: 'ADJUSTMENT', balance: 0, notes: 'Perda' }),
    ).resolves.toMatchObject({ balance: 0 });
  });

  it('does not accept a sale, which only the invoice records', async () => {
    await expect(messagesOf({ type: 'SALE', quantity: 1 })).resolves.toContain(
      'Tipo inválido: use ENTRY (entrada), RETURN (devolução) ou ADJUSTMENT (ajuste)',
    );
  });

  it('requires a positive whole quantity in the entry and the return', async () => {
    await expect(messagesOf({ type: 'ENTRY' })).resolves.toContain(
      'A quantidade deve ser um número inteiro',
    );
    await expect(
      messagesOf({ type: 'RETURN', quantity: 0 }),
    ).resolves.toContain('A quantidade deve ser maior que zero');
    await expect(
      messagesOf({ type: 'ENTRY', quantity: 1_000_001 }),
    ).resolves.toContain('A quantidade deve ser de no máximo 1000000');
  });

  it('requires the counted stock and the reason in the adjustment', async () => {
    const messages = await messagesOf({
      type: 'ADJUSTMENT',
      quantity: 3,
      notes: '  ',
    });

    expect(messages).toEqual(
      expect.arrayContaining([
        'O saldo contado deve ser um número inteiro',
        'Informe o motivo do ajuste',
      ]),
    );
    await expect(
      messagesOf({ type: 'ADJUSTMENT', balance: -1, notes: 'Contagem' }),
    ).resolves.toContain('O saldo contado não pode ser negativo');
  });
});
