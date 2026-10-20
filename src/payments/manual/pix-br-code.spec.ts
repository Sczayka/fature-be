import { buildStaticPixPayload, pixQrCodeImage } from './pix-br-code.js';

/** Exemplo do Manual de Padrões para Iniciação do Pix (BCB). */
const BCB_EXAMPLE = {
  key: '123e4567-e12b-12d1-a456-426655440000',
  merchantName: 'Fulano de Tal',
  merchantCity: 'BRASILIA',
  amount: null,
  txid: '***',
};

describe('buildStaticPixPayload', () => {
  it('builds the example of the BCB manual', () => {
    expect(buildStaticPixPayload(BCB_EXAMPLE)).toBe(
      '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D',
    );
  });

  it('includes the amount when the value is known', () => {
    expect(buildStaticPixPayload({ ...BCB_EXAMPLE, amount: 10.5 })).toBe(
      '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-426655440000520400005303986540510.505802BR5913Fulano de Tal6008BRASILIA62070503***6304AEEE',
    );
  });

  it('removes accents and symbols and cuts the name to 25 characters', () => {
    const payload = buildStaticPixPayload({
      ...BCB_EXAMPLE,
      merchantName: 'José & Conceição Serviços de Informática Ltda.',
      merchantCity: 'São José dos Pinhais',
    });

    expect(payload).toContain('5925Jose Conceicao Servicos d6015');
    expect(payload).toContain('6015Sao Jose dos Pi6207');
    expect(payload).toMatch(/6304[0-9A-F]{4}$/);
  });

  it('does not leave a trailing space when the cut falls on one', () => {
    const payload = buildStaticPixPayload({
      ...BCB_EXAMPLE,
      merchantName: 'Comercio de Alimentos XY Vista',
    });

    expect(payload).toContain('5924Comercio de Alimentos XY6008');
  });
});

describe('pixQrCodeImage', () => {
  it('renders a PNG in base64 without the data URL prefix', async () => {
    const image = await pixQrCodeImage(
      buildStaticPixPayload({ ...BCB_EXAMPLE, amount: 10.5 }),
    );

    expect(image).not.toMatch(/^data:/);
    expect(Buffer.from(image, 'base64').subarray(1, 4).toString()).toBe('PNG');
  });
});
