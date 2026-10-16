import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PayWithCreditCardDto } from './pay-with-credit-card.dto.js';

const holder = {
  name: 'Titular',
  email: 'titular@email.com',
  cpfCnpj: '12345678909',
  postalCode: '01001000',
  addressNumber: '10',
  phone: '11999999999',
};

const card = {
  holderName: 'TITULAR',
  number: '4444444444444444',
  expiryMonth: '12',
  expiryYear: '2030',
  ccv: '123',
};

async function errorsOf(payload: object) {
  const errors = await validate(plainToInstance(PayWithCreditCardDto, payload));

  return errors.map((error) => error.property);
}

describe('PayWithCreditCardDto', () => {
  it('accepts the card data captured by the Fature form', async () => {
    await expect(errorsOf({ mode: 'RAW', card, holder })).resolves.toEqual([]);
  });

  it('requires the card data in RAW mode', async () => {
    await expect(errorsOf({ mode: 'RAW', holder })).resolves.toContain('card');
  });

  it('requires only the provider token in PROVIDER_TOKEN mode', async () => {
    await expect(
      errorsOf({ mode: 'PROVIDER_TOKEN', token: 'tok_1', holder }),
    ).resolves.toEqual([]);
    await expect(
      errorsOf({ mode: 'PROVIDER_TOKEN', holder }),
    ).resolves.toContain('token');
  });

  it('rejects malformed card and holder data', async () => {
    const errors = await validate(
      plainToInstance(PayWithCreditCardDto, {
        mode: 'RAW',
        card: { ...card, number: '4444', expiryMonth: '13' },
        holder: { ...holder, cpfCnpj: '123', postalCode: 'abc' },
      }),
    );
    const [cardErrors, holderErrors] = ['card', 'holder'].map((property) =>
      errors
        .find((error) => error.property === property)!
        .children!.map((child) => child.property),
    );

    expect(cardErrors).toEqual(['number', 'expiryMonth']);
    expect(holderErrors).toEqual(['cpfCnpj', 'postalCode']);
  });
});
