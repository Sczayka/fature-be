import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateCustomizationDto } from './update-customization.dto.js';

const customization = {
  slug: 'raipp-studio',
  wallpaper: 'WAVES',
  backgroundColor: '#9db4dc',
  buttonColor: '#5b3fd1',
};

async function errorsOf(payload: object) {
  const errors = await validate(
    plainToInstance(UpdateCustomizationDto, payload),
  );

  return errors.map((error) => error.property);
}

describe('UpdateCustomizationDto', () => {
  it('accepts the customization and normalizes the URL and the colors', async () => {
    const dto = plainToInstance(UpdateCustomizationDto, {
      ...customization,
      slug: '  Raipp-Studio ',
      backgroundColor: '#9DB4DC',
    });

    await expect(validate(dto)).resolves.toEqual([]);
    expect(dto).toMatchObject({
      slug: 'raipp-studio',
      backgroundColor: '#9db4dc',
    });
  });

  it('accepts null to go back to the Fature defaults', async () => {
    await expect(
      errorsOf({
        slug: 'raipp-studio',
        wallpaper: null,
        backgroundColor: null,
        buttonColor: null,
      }),
    ).resolves.toEqual([]);
  });

  it('requires every field', async () => {
    await expect(errorsOf({})).resolves.toEqual([
      'slug',
      'wallpaper',
      'backgroundColor',
      'buttonColor',
    ]);
  });

  it('rejects malformed values', async () => {
    await expect(
      errorsOf({
        slug: 'raipp studio',
        wallpaper: 'STARS',
        backgroundColor: '#fff',
        buttonColor: 'red',
      }),
    ).resolves.toEqual(['slug', 'wallpaper', 'backgroundColor', 'buttonColor']);
  });

  it('rejects URLs with hyphens at the edges or out of the length limits', async () => {
    for (const slug of [
      '-raipp',
      'raipp-',
      'raipp--studio',
      'ab',
      'a'.repeat(64),
    ]) {
      await expect(errorsOf({ ...customization, slug })).resolves.toEqual([
        'slug',
      ]);
    }
  });
});
